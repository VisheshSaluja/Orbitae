import { useEffect, useState, useMemo } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { ProjectCard } from './components/ProjectCard';
import { ProjectWorkspace } from './components/Workspace/ProjectWorkspace';
import { NewProjectModal } from './components/NewProjectModal';
import { useAppStore } from './stores/useAppStore';
import { Button } from './components/ui/button';
import { Plus } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { invokeCommand } from './lib/tauri';
import { Search, ArrowUpDown, Calendar, Clock, Folder } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './components/ui/dropdown-menu';
import { open } from '@tauri-apps/plugin-dialog';

function App() {
  const [activeTerminalProject, setActiveTerminalProject] = useState<string | null>(null);
  
  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'created_desc' | 'created_asc' | 'updated_desc' | 'name_asc'>('created_desc');

  const { 
    projects, 
    fetchProjects, 
    createProject 
  } = useAppStore();

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleLaunch = (id: string) => {
    setActiveTerminalProject(id);
  };

  const filteredProjects = useMemo(() => {
      let result = [...projects];

      // 1. Filter
      if (searchQuery) {
          const lower = searchQuery.toLowerCase();
          result = result.filter(p => p.name.toLowerCase().includes(lower) || p.path.toLowerCase().includes(lower));
      }

      // 2. Sort
      result.sort((a, b) => {
          switch (sortBy) {
              case 'name_asc':
                  return a.name.localeCompare(b.name);
              case 'created_desc':
                  // Fallback to name if date missing (legacy projects) or equal
                  return (b.created_at || '').localeCompare(a.created_at || '') || a.name.localeCompare(b.name);
              case 'created_asc':
                  return (a.created_at || '').localeCompare(b.created_at || '') || a.name.localeCompare(b.name);
              case 'updated_desc':
                   return (b.updated_at || '').localeCompare(a.updated_at || '') || a.name.localeCompare(b.name);
              default:
                  return 0;
          }
      });
      
      return result;
  }, [projects, searchQuery, sortBy]);

  // Import State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importName, setImportName] = useState('');

  // Clone State
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneParentPath, setCloneParentPath] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [isCloning, setIsCloning] = useState(false);

  // "Start from an idea" — the description becomes the agent's first message,
  // so onboarding and the first plan are the same flow.
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);

  const handleNewProject = async (mode: 'create' | 'import' | 'clone' = 'create') => {
    if (mode === 'create') {
        setIsNewProjectOpen(true);
    } else if (mode === 'import') {
        setImportName('');
        setImportPath('');
        setIsImportOpen(true);
    } else if (mode === 'clone') {
        setCloneName('');
        setCloneUrl('');
        setCloneParentPath(''); 
        setIsCloneOpen(true);
    }
  };

  const handleBrowse = async (setter: (val: string) => void, nameSetter?: (val: string) => void, currentName?: string) => {
      try {
          const selected = await open({
              directory: true,
              multiple: false,
          });
          if (selected) {
              setter(selected as string);
              // Auto-populate name from folder basename when name is empty
              if (nameSetter && !currentName?.trim()) {
                  const basename = (selected as string).split('/').pop() ?? '';
                  if (basename) {
                      nameSetter(basename);
                  }
              }
          }
      } catch {
          // Dialog open failed — non-critical
      }
  };

  const submitImport = async () => {
    if (!importName || !importPath) {
        toast.error("Name and Path are required");
        return;
    }
    
    try {
        await createProject(importName, importPath);
        toast.success("Project imported");
        setIsImportOpen(false);
    } catch {
        toast.error("Failed to import project");
    }
  };

  const submitClone = async () => {
      if (!cloneName || !cloneUrl || !cloneParentPath) {
          toast.error("All fields are required");
          return;
      }
      
      setIsCloning(true);
      try {
          // 1. Construct full path
          // If cloneParentPath ends with /, remove it.
          const parent = cloneParentPath.replace(/\/$/, '');
          // Since git clone creates the directory, we clone into parent/name-slug
          // Or we can just trust user provided path.
          // Standard: git clone <url> <path>
          // Let's assume user gives PARENT directory. We should append slug.
          const slug = cloneName.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
          const fullPath = `${parent}/${slug}`;

          // 2. Clone
          toast.info("Cloning repository... this may take a while");
          await invokeCommand('git_clone', { url: cloneUrl, path: fullPath });
          
          // 3. Register Project
          await createProject(cloneName, fullPath);
          toast.success("Repository cloned and project created");
          setIsCloneOpen(false);
      } catch {
          toast.error("Failed to clone repository");
      } finally {
          setIsCloning(false);
      }
  };

  // Looked up defensively — if the id doesn't (yet) resolve to a project, fall
  // back to the list view instead of handing ProjectWorkspace an undefined
  // project and crashing the whole app with no error boundary to catch it.
  const activeProject = activeTerminalProject ? projects.find(p => p.id === activeTerminalProject) ?? null : null;

  return (
    <>
        {activeProject ? (
            <ProjectWorkspace
                project={activeProject}
                initialPrompt={initialPrompt}
                onClose={() => {
                    setActiveTerminalProject(null);
                    setInitialPrompt(null);
                    fetchProjects();
                }}
            />
        ) : (
            <AppLayout
                projectCount={projects.length}
                onNewProject={handleNewProject}
            >
                {projects.length > 0 ? (
                  <div className="space-y-6">
                      {/* Toolbar */}
                      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                          <div className="relative w-full sm:w-72">
                              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Search projects..."
                                className="pl-9"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                              />
                          </div>
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                      <Button variant="outline" size="sm" className="ml-auto sm:ml-0 gap-2">
                                          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                                          <span className="hidden sm:inline">Sort:</span>
                                          <span className="font-medium">
                                              {sortBy === 'created_desc' && 'Newest'}
                                              {sortBy === 'created_asc' && 'Oldest'}
                                              {sortBy === 'updated_desc' && 'Recently Updated'}
                                              {sortBy === 'name_asc' && 'Name'}
                                          </span>
                                      </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => setSortBy('created_desc')}>
                                          <Calendar className="w-4 h-4 mr-2" /> Newest Created
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => setSortBy('created_asc')}>
                                          <Calendar className="w-4 h-4 mr-2" /> Oldest Created
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => setSortBy('updated_desc')}>
                                          <Clock className="w-4 h-4 mr-2" /> Recently Updated
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => setSortBy('name_asc')}>
                                          <span className="ml-6">Name (A-Z)</span>
                                      </DropdownMenuItem>
                                  </DropdownMenuContent>
                              </DropdownMenu>
                          </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                        {filteredProjects.map(project => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            onLaunch={handleLaunch}
                          />
                        ))}

                        {filteredProjects.length === 0 && (
                            <div className="col-span-full py-12 text-center text-muted-foreground">
                                <p>No projects match your search.</p>
                                <Button variant="link" onClick={() => setSearchQuery('')}>Clear Search</Button>
                            </div>
                        )}
                      </div>
                  </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-foreground/[0.06] flex items-center justify-center mb-6">
                             <Plus className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-base font-semibold tracking-tight text-foreground">Welcome to Orbitae</h3>
                        <p className="text-[13px] text-muted-foreground mt-2 mb-7 max-w-sm leading-relaxed">
                            Your AI-native project runtime. Manage secrets, orchestrate agents, and ship faster.
                        </p>
                        <Button onClick={() => handleNewProject('create')} className="bg-foreground text-background hover:bg-foreground/90 px-6">
                            Create Your First Project
                        </Button>
                    </div>
                )}
            </AppLayout>
        )}

        {/* Import Dialog */}
        <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import Existing Project</DialogTitle>
                    <DialogDescription>
                        Import a local folder or Git repository into Orbitae.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Project Name</Label>
                        <Input 
                            placeholder="My Project" 
                            value={importName} 
                            onChange={(e) => setImportName(e.target.value)} 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Absolute System Path</Label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="/Users/username/projects/my-app"
                                value={importPath}
                                onChange={(e) => setImportPath(e.target.value)}
                                onBlur={() => {
                                    if (!importName.trim() && importPath.trim()) {
                                        const basename = importPath.trim().replace(/\/+$/, '').split('/').pop() ?? '';
                                        if (basename) setImportName(basename);
                                    }
                                }}
                                className="font-mono text-xs"
                            />
                            <Button variant="outline" size="icon" onClick={() => handleBrowse(setImportPath, setImportName, importName)}>
                                <Folder className="w-4 h-4" />
                            </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground w-full break-all">
                            Tip: You can drag and drop a folder from Finder into this input or just type the path.
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsImportOpen(false)}>Cancel</Button>
                    <Button onClick={submitImport}>Import Project</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Clone Dialog */}
        <Dialog open={isCloneOpen} onOpenChange={setIsCloneOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Clone Git Repository</DialogTitle>
                    <DialogDescription>
                        Clone a repository from a remote URL.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                     <div className="space-y-2">
                        <Label>Project Name</Label>
                        <Input 
                            placeholder="My Project" 
                            value={cloneName} 
                            onChange={(e) => setCloneName(e.target.value)} 
                        />
                    </div>
                     <div className="space-y-2">
                        <Label>Repository URL</Label>
                        <Input 
                            placeholder="https://github.com/username/repo.git" 
                            value={cloneUrl} 
                            onChange={(e) => setCloneUrl(e.target.value)} 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Clone Location (Parent Directory)</Label>
                        <div className="flex gap-2">
                            <Input 
                                placeholder="/Users/username/projects" 
                                value={cloneParentPath} 
                                onChange={(e) => setCloneParentPath(e.target.value)} 
                                className="font-mono text-xs"
                            />
                            <Button variant="outline" size="icon" onClick={() => handleBrowse(setCloneParentPath)}>
                                <Folder className="w-4 h-4" />
                            </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            The repository will be cloned into a new folder inside this directory.
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCloneOpen(false)} disabled={isCloning}>Cancel</Button>
                    <Button onClick={submitClone} disabled={isCloning}>
                        {isCloning ? 'Cloning...' : 'Clone Repository'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <NewProjectModal
            open={isNewProjectOpen}
            onOpenChange={setIsNewProjectOpen}
            onCreated={async (project, description) => {
                // Refresh the store's project list BEFORE navigating — otherwise
                // `projects.find(...)` below misses the brand-new project on the
                // next render and ProjectWorkspace gets an undefined `project`.
                await fetchProjects();
                setInitialPrompt(description);
                setActiveTerminalProject(project.id);
            }}
        />
        <Toaster />
    </>
  );
}

export default App;
