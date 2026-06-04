import { useState, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import { invokeCommand } from '../lib/tauri';
import { listen } from '@tauri-apps/api/event';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useAppStore } from '../stores/useAppStore';
import { Loader2, Download, FileText, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Progress } from './ui/progress';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Error boundary caught an error — state already updated via getDerivedStateFromError
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center flex flex-col items-center justify-center h-full">
            <h2 className="text-red-500 font-bold mb-2 text-xl">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 max-w-md">{this.state.error?.message}</p>
            <Button onClick={() => this.setState({ hasError: false, error: null })}>Try Again</Button>
        </div>
      );
    }

    return this.props.children; 
  }
}

const ReadmeGeneratorContent = () => {
    const { projects } = useAppStore();
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [modelStatus, setModelStatus] = useState<{ present: boolean, progress: number }>({ present: false, progress: 0 });
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedContent, setGeneratedContent] = useState('');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const setupListener = async () => {
             try {
                // listen returns a Promise that resolves to an unlisten function
                const unlistenFn = await listen<number>('llm:download-progress', (event) => {
                    setDownloadProgress(event.payload);
                });
                unlisten = unlistenFn;
             } catch {
                 // Failed to setup listener — non-critical
             }
        };

        checkModel();
        setupListener();

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const checkModel = async () => {
        try {
            const status = await invokeCommand<{ present: boolean, progress: number }>('check_model_status');
            setModelStatus(status);
        } catch {
            // Model check failed — UI will show download screen
        }
    };

    const handleDownload = async () => {
        setIsDownloading(true);
        setDownloadProgress(0);
        try {
            toast.info("Downloading model... this may take a few minutes.");
            await invokeCommand('download_model');
            await checkModel();
            toast.success("Model downloaded successfully!");
        } catch (e) {
            toast.error("Failed to download model: " + e);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleGenerate = async () => {
        if (!selectedProject) return;
        
        setIsGenerating(true);
        setGeneratedContent('');
        
        const project = projects.find(p => p.id === selectedProject);
        if (!project) return;

        try {
             // Show starting toast
            toast.info("Analyzing codebase...");
            
            const content = await invokeCommand<string>('generate_readme', { projectPath: project.path });
            if (!content || content.trim().length === 0) {
                toast.warning("AI generated empty content. Try a smaller project or check logs.");
            } else {
                setGeneratedContent(content);
                toast.success(`Readme generated! (${content.length} chars)`);
            }
        } catch (e) {
            toast.error("Generation failed: " + e);
        } finally {
            setIsGenerating(false);
        }
    };
    
    // Derived state for UI to decide which screen to show
    // If model is NOT present, show download screen
    const showDownloadScreen = !modelStatus.present;

    if (showDownloadScreen) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center max-w-2xl mx-auto h-[80vh]">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
                    <Download className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-2xl font-bold mb-2">AI Model Required</h2>
                <p className="text-muted-foreground mb-8">
                    To generate READMEs securely on your device, we need to download a small language model (Phi-3.5-mini, ~600MB).
                    This happens only once.
                </p>
                
                {isDownloading ? (
                    <div className="w-full max-w-sm space-y-4">
                        <div className="flex items-center gap-2 justify-center text-sm text-primary animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Downloading & Optimizing... {downloadProgress > 0 && `${downloadProgress.toFixed(0)}%`}
                        </div>
                        <Progress value={downloadProgress} className="w-full" />
                        <p className="text-xs text-muted-foreground">Please do not close the app.</p>
                    </div>
                ) : (
                    <Button onClick={handleDownload} size="lg">
                        Download Model (~600MB)
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-5xl h-full flex flex-col">
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        Readme Generator
                    </h1>
                    <p className="text-muted-foreground">
                        Generate comprehensive documentation for your projects using local AI.
                    </p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full pb-6">
                {/* Visual Sidebar / Controls */}
                <div className="lg:col-span-1 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configuration</CardTitle>
                            <CardDescription>Select a project to document.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Project</label>
                                <Select value={selectedProject} onValueChange={setSelectedProject}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select project..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {projects.map(p => (
                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="pt-4">
                                <Button 
                                    className="w-full" 
                                    size="lg" 
                                    onClick={handleGenerate} 
                                    disabled={!selectedProject || isGenerating}
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Analyzing Codebase...
                                        </>
                                    ) : (
                                        <>
                                            <FileText className="mr-2 h-4 w-4" />
                                            Generate Readme
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                        <CardFooter className="bg-muted/50 text-xs text-muted-foreground p-4">
                            <AlertCircle className="w-3 h-3 mr-2" />
                            AI runs locally. Large projects may take 30-60s.
                        </CardFooter>
                    </Card>
                </div>

                {/* Editor / Preview */}
                <div className="lg:col-span-2 h-full min-h-[500px]">
                    <Card className="h-full flex flex-col">
                        <div className="flex-1 p-0 overflow-hidden relative">
                            {generatedContent ? (
                                <textarea 
                                    className="w-full h-full p-6 resize-none font-mono text-sm bg-transparent border-0 focus:ring-0 outline-none"
                                    value={generatedContent}
                                    onChange={(e) => setGeneratedContent(e.target.value)}
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                                    <p>Generated content will appear here.</p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export const ReadmeGenerator = () => (
    <ErrorBoundary>
        <ReadmeGeneratorContent />
    </ErrorBoundary>
);
