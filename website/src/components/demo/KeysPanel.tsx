import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '../ui/dialog';
import { Eye, Lock, Key, Trash2, Plus } from 'lucide-react';
import { invokeCommand } from '../../lib/mock-tauri';
import { toast } from 'sonner';
import type { ProjectKey } from '../../types';

interface KeysPanelProps {
    projectId: string;
}

export const KeysPanel: React.FC<KeysPanelProps> = ({ projectId }) => {
    const [keys, setKeys] = useState<ProjectKey[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    
    // Reveal State
    const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
    const [revealedSecretName, setRevealedSecretName] = useState<string | null>(null);
    
    // Form State
    const [newName, setNewName] = useState('');
    const [newSecret, setNewSecret] = useState('');

    const fetchKeys = async () => {
        setIsLoading(true);
        try {
            const data = await invokeCommand<ProjectKey[]>('get_project_keys', { projectId });
            setKeys(data);
        } catch (e) {
            console.error(e);
            toast.error("Failed to load keys");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchKeys();
    }, [projectId]);

    const handleAddKey = async () => {
        if (!newName || !newSecret) return;
        
        try {
            await invokeCommand('add_project_key', {
                projectId,
                name: newName,
                secret: newSecret
            });
            toast.success("Key added securely");
            setNewName('');
            setNewSecret('');
            setIsAddOpen(false);
            fetchKeys();
        } catch (e) {
            console.error(e);
            toast.error("Failed to add key");
        }
    };

    const handleDeleteKey = async (id: string, keyReference: string) => {
        try {
            await invokeCommand('delete_project_key', { id, keyReference });
            toast.success("Key deleted");
            fetchKeys();
        } catch (e) {
            console.error(e);
            toast.error("Failed to delete key");
        }
    };

    const handleRevealSecret = async (name: string, keyReference: string) => {
        const toastId = toast.loading("Authenticating...");
        try {
            // Backend will handle TouchID now
            console.log("Requesting secret for:", keyReference);
            const secret = await invokeCommand<string>('reveal_secret', { keyReference });
            console.log("Secret received");
            toast.dismiss(toastId);
            
            setRevealedSecret(secret);
            setRevealedSecretName(name);
            
        } catch (e) {
            toast.dismiss(toastId);
            console.error("Reveal failed:", e);
            toast.error("Authentication failed or cancelled");
        }
    };

    return (
        <div className="h-full flex flex-col p-4 space-y-4 overflow-hidden">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Lock className="w-5 h-5 text-primary" />
                        Keys & Secrets
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Securely manage environment variables and access tokens.
                    </p>
                </div>
                
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-1">
                            <Plus className="w-4 h-4" />
                            Add Key
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add New Secret</DialogTitle>
                            <DialogDescription>
                                Stored securely in your system's Keychain (TouchID/Password protected).
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Name</label>
                                <Input 
                                    placeholder="e.g. AWS_ACCESS_KEY" 
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Secret Value</label>
                                <Input 
                                    type="password"
                                    placeholder="••••••••••••••••" 
                                    value={newSecret}
                                    onChange={(e) => setNewSecret(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                            <Button onClick={handleAddKey} disabled={!newName || !newSecret}>Save Securely</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Reveal Dialog */}
                <Dialog open={!!revealedSecret} onOpenChange={(open) => !open && setRevealedSecret(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Secret Revealed: {revealedSecretName}</DialogTitle>
                            <DialogDescription>
                                This secret was retrieved securely from your Keychain.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="p-4 bg-muted rounded-md break-all font-mono text-sm relative group">
                            {revealedSecret}
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                    if (revealedSecret) {
                                        navigator.clipboard.writeText(revealedSecret);
                                        toast.success("Copied!");
                                    }
                                }}
                            >
                                Copy
                            </Button>
                        </div>
                        <DialogFooter>
                            <Button onClick={() => setRevealedSecret(null)}>Close</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 p-1">
                {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}
                
                {!isLoading && keys.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No keys stored yet.</p>
                    </div>
                )}

                {keys.map(key => (
                    <Card key={key.id} className="group hover:border-primary/50 transition-colors">
                        <CardContent className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-md bg-muted text-muted-foreground">
                                    <Key className="w-4 h-4" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-sm">{key.name}</span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                        ID: {key.id.slice(0, 8)}...
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => handleRevealSecret(key.name, key.key_reference)}
                                    title="Reveal Secret"
                                >
                                    <Eye className="w-4 h-4" />
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                    onClick={() => handleDeleteKey(key.id, key.key_reference)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};
