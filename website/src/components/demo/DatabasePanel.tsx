import React, { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Plus, Trash2, Database, RefreshCw, Server, CheckCircle, XCircle, Play, ArrowLeft } from 'lucide-react';
import { invokeCommand } from '../../lib/mock-tauri';
import { toast } from 'sonner';
import type { ProjectConnection } from '../../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';

interface DatabasePanelProps {
    projectId: string;
}

interface QueryResult {
    columns: string[];
    rows: any[][];
    affected_rows: number;
}

export const DatabasePanel: React.FC<DatabasePanelProps> = ({ projectId }) => {
    const [connections, setConnections] = useState<ProjectConnection[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // View State
    const [activeConnection, setActiveConnection] = useState<ProjectConnection | null>(null);
    const [view, setView] = useState<'list' | 'query'>('list');

    // Query State
    const [sqlQuery, setSqlQuery] = useState('SELECT * FROM sqlite_master LIMIT 10;');
    const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);

    // Dialog State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newKind, setNewKind] = useState<'postgres' | 'mysql' | 'sqlite'>('postgres');
    
    // Connection Details
    const [host, setHost] = useState('localhost');
    const [port, setPort] = useState('5432');
    const [username, setUsername] = useState('postgres');
    const [password, setPassword] = useState('');
    const [database, setDatabase] = useState('postgres');
    const [filePath, setFilePath] = useState('');

    // Test Status
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

    const fetchConnections = async () => {
        setIsLoading(true);
        try {
            const data = await invokeCommand<ProjectConnection[]>('get_connections', { projectId });
            setConnections(data);
        } catch (e) {
            console.error(e);
            toast.error("Failed to load connections");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchConnections();
    }, [projectId]);

    const resetForm = () => {
        setNewName('');
        setNewKind('postgres');
        setHost('localhost');
        setPort('5432');
        setUsername('postgres');
        setPassword('');
        setDatabase('postgres');
        setFilePath('');
        setTestStatus('idle');
    };

    const handleCreate = () => {
        resetForm();
        setIsCreateOpen(true);
    };

    const getDetailsJson = () => {
        if (newKind === 'sqlite') {
            return JSON.stringify({ file_path: filePath });
        }
        return JSON.stringify({
            host,
            port: parseInt(port),
            username,
            database,
            password 
        });
    };
    
    const handleTest = async () => {
        setTestStatus('testing');
        const details = getDetailsJson();
        try {
            await invokeCommand('test_connection', {
                kind: newKind,
                details,
                password: newKind === 'sqlite' ? null : password
            });
            setTestStatus('success');
            toast.success("Connection successful");
        } catch (e) {
            console.error(e);
            setTestStatus('error');
            toast.error("Connection failed: " + e);
        }
    };

    const handleSubmit = async () => {
        if (!newName) return toast.error("Name required");
        
        try {
            await invokeCommand('create_connection', {
                projectId,
                name: newName,
                kind: newKind,
                details: getDetailsJson()
            });
            
            toast.success("Connection saved");
            setIsCreateOpen(false);
            fetchConnections();
        } catch (e) {
            toast.error("Failed to save connection");
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure?")) return;
        try {
            await invokeCommand('delete_connection', { id });
            toast.success("Connection deleted");
            fetchConnections();
        } catch (e) {
            toast.error("Failed to delete");
        }
    };

    // Table State
    const [tables, setTables] = useState<{name: string, schema: string | null}[]>([]);
    const [isLoadingTables, setIsLoadingTables] = useState(false);

    const fetchTables = async (conn: ProjectConnection) => {
        setIsLoadingTables(true);
        try {
            const data = await invokeCommand<{name: string, schema: string | null}[]>('get_tables', {
                kind: conn.kind,
                details: conn.details,
                password: null // TODO: Handle password
            });
            setTables(data);
        } catch (e) {
            console.error("Failed to fetch tables", e);
            toast.error("Could not load table schema");
        } finally {
            setIsLoadingTables(false);
        }
    };

    const handleOpenQuery = (conn: ProjectConnection) => {
        setActiveConnection(conn);
        setView('query');
        // Default query based on type
        if (conn.kind === 'sqlite') {
            setSqlQuery('SELECT * FROM sqlite_master LIMIT 10;');
        } else if (conn.kind === 'postgres') {
            setSqlQuery('SELECT * FROM information_schema.tables LIMIT 10;');
        } else {
            setSqlQuery('SHOW TABLES;');
        }
        setQueryResult(null);
        fetchTables(conn);
    };

    const handleTableClick = (tableName: string, schema: string | null) => {
        const fullName = schema ? `${schema}.${tableName}` : tableName;
        setSqlQuery(`SELECT * FROM ${fullName} LIMIT 100;`);
    };

    const handleRunQuery = async () => {
        if (!activeConnection) return;
        setIsExecuting(true);
        try {
            const res = await invokeCommand<QueryResult>('execute_query', {
                kind: activeConnection.kind,
                details: activeConnection.details,
                query: sqlQuery,
                password: null // Ideally passed from vault or prompt
            });
            setQueryResult(res);
            toast.success("Query executed");
        } catch (e: any) {
            console.error(e);
            toast.error("Query failed: " + e);
        } finally {
            setIsExecuting(false);
        }
    };

    if (view === 'query' && activeConnection) {
        return (
            <div className="h-full flex flex-col p-4 space-y-4">
                 <div className="flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                         <Button variant="ghost" size="icon" onClick={() => setView('list')}>
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <div>
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Database className="w-4 h-4 text-primary" />
                                {activeConnection.name}
                            </h2>
                            <p className="text-xs text-muted-foreground font-mono opacity-80">
                                {activeConnection.kind}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex gap-4 overflow-hidden">
                    {/* Schema Sidebar */}
                    <div className="w-64 border rounded-md flex flex-col bg-card overflow-hidden shrink-0">
                        <div className="p-3 border-b bg-muted/30 font-medium text-sm flex items-center justify-between">
                            <span>Tables</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => fetchTables(activeConnection)}>
                                <RefreshCw className={`w-3 h-3 ${isLoadingTables ? 'animate-spin' : ''}`} />
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {isLoadingTables && tables.length === 0 ? (
                                <div className="text-center py-4 text-xs text-muted-foreground">Loading...</div>
                            ) : tables.length === 0 ? (
                                <div className="text-center py-4 text-xs text-muted-foreground">No tables found</div>
                            ) : (
                                tables.map((t, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleTableClick(t.name, t.schema)}
                                        className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50 flex items-center gap-2 truncate transition-colors"
                                    >
                                        <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                                        <span className="truncate flex-1 font-mono" title={t.name}>
                                            {t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Query Area */}
                    <div className="flex-1 flex flex-col gap-4 overflow-hidden min-w-0">
                        <div className="flex flex-col gap-2 shrink-0">
                            <Label>SQL Query</Label>
                            <div className="relative">
                                <Textarea 
                                    value={sqlQuery} 
                                    onChange={e => setSqlQuery(e.target.value)} 
                                    className="font-mono min-h-[120px] resize-y"
                                    placeholder="SELECT * FROM table;"
                                />
                                <Button 
                                    size="sm" 
                                    className="absolute bottom-3 right-3 gap-2 shadow-lg" 
                                    onClick={handleRunQuery}
                                    disabled={isExecuting}
                                >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    {isExecuting ? 'Running...' : 'Run'}
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 border rounded-md overflow-hidden flex flex-col bg-muted/10">
                            {queryResult ? (
                                <div className="flex-1 overflow-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted sticky top-0 z-10">
                                            <tr>
                                                {queryResult.columns.map((col, i) => (
                                                    <th key={i} className="px-4 py-2 text-left font-medium border-b text-xs text-muted-foreground whitespace-nowrap bg-muted">
                                                        {col}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {queryResult.rows.map((row, i) => (
                                                <tr key={i} className="border-b hover:bg-muted/50">
                                                    {row.map((cell, j) => (
                                                        <td key={j} className="px-4 py-2 border-r last:border-r-0 max-w-[300px] truncate">
                                                            {typeof cell === 'object' ? JSON.stringify(cell) : String(cell)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {queryResult.rows.length === 0 && (
                                        <div className="p-8 text-center text-muted-foreground text-sm">
                                            No results found
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                                    Run a query to see results
                                </div>
                            )}
                            {queryResult && (
                                 <div className="border-t bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground flex justify-between shrink-0">
                                    <span>{queryResult.rows.length} rows</span>
                                    <span>{queryResult.columns.length} columns</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                     <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Database className="w-5 h-5 text-primary" />
                        Databases
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Manage database connections for this project.
                    </p>
                </div>
                <Button onClick={handleCreate} className="gap-1">
                    <Plus className="w-4 h-4" />
                    New Connection
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {connections.map(conn => (
                    <Card 
                        key={conn.id} 
                        className="group hover:shadow-md transition-all cursor-pointer hover:border-primary/50"
                        onClick={() => handleOpenQuery(conn)}
                    >
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Server className="w-4 h-4 text-muted-foreground" />
                                    {conn.name}
                                </div>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => handleDelete(conn.id, e)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="uppercase text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded">
                                    {conn.kind}
                                </span>
                            </div>
                            <div className="truncate font-mono text-xs opacity-70">
                                {conn.details}
                            </div>
                        </CardContent>
                    </Card>
                ))}
                
                {connections.length === 0 && !isLoading && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                        <Database className="w-10 h-10 mx-auto mb-2 opacity-20" />
                        <p>No database connections yet</p>
                        <Button variant="link" onClick={handleCreate}>Add one</Button>
                    </div>
                )}
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add Database Connection</DialogTitle>
                        <DialogDescription>
                            Connect to a Postgres, MySQL, or SQLite database.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-2">
                        {/* Form similar to before */}
                         <div className="space-y-2">
                            <Label>Name</Label>
                            <Input placeholder="Local DB" value={newName} onChange={e => setNewName(e.target.value)} />
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select value={newKind} onValueChange={(v: any) => setNewKind(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="postgres">PostgreSQL</SelectItem>
                                        <SelectItem value="mysql">MySQL</SelectItem>
                                        <SelectItem value="sqlite">SQLite</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {newKind === 'sqlite' ? (
                            <div className="space-y-2">
                                <Label>File Path</Label>
                                <Input placeholder="/path/to/db.sqlite" value={filePath} onChange={e => setFilePath(e.target.value)} />
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="col-span-2 space-y-2">
                                        <Label>Host</Label>
                                        <Input placeholder="localhost" value={host} onChange={e => setHost(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Port</Label>
                                        <Input placeholder="5432" value={port} onChange={e => setPort(e.target.value)} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                     <div className="space-y-2">
                                        <Label>Username</Label>
                                        <Input placeholder="postgres" value={username} onChange={e => setUsername(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Password</Label>
                                        <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
                                        <p className="text-[10px] text-muted-foreground mt-1">
                                            Stored as plain text (MVP only)
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Database Name</Label>
                                    <Input placeholder="postgres" value={database} onChange={e => setDatabase(e.target.value)} />
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter className="flex justify-between items-center sm:justify-between">
                         <Button 
                            type="button" 
                            variant="ghost" 
                            onClick={handleTest}
                            disabled={testStatus === 'testing'}
                            className={testStatus === 'success' ? 'text-green-600' : testStatus === 'error' ? 'text-red-600' : ''}
                        >
                            {testStatus === 'testing' ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : 
                             testStatus === 'success' ? <CheckCircle className="w-4 h-4 mr-2" /> :
                             testStatus === 'error' ? <XCircle className="w-4 h-4 mr-2" /> :
                             <Activity className="w-4 h-4 mr-2" />
                            }
                            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                            <Button onClick={handleSubmit}>Save</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

function Activity(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}
