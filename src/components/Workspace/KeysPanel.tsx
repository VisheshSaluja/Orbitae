import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '../ui/dialog';
import { Eye, Lock, Key, Trash2, Plus } from 'lucide-react';
import { invokeCommand } from '../../lib/tauri';
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
        } catch {
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
        } catch {
            toast.error("Failed to add key");
        }
    };

    const handleDeleteKey = async (id: string, keyReference: string) => {
        try {
            await invokeCommand('delete_project_key', { id, keyReference });
            toast.success("Key deleted");
            fetchKeys();
        } catch {
            toast.error("Failed to delete key");
        }
    };

    const handleRevealSecret = async (name: string, keyReference: string) => {
        const toastId = toast.loading("Authenticating...");
        try {
            // Backend will handle TouchID now
            const secret = await invokeCommand<string>('reveal_secret', { keyReference });
            toast.dismiss(toastId);
            
            setRevealedSecret(secret);
            setRevealedSecretName(name);
            
        } catch {
            toast.dismiss(toastId);
            toast.error("Authentication failed or cancelled");
        }
    };

    return (
        <div className="h-full flex flex-col p-4 space-y-4 overflow-hidden">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Keys & Secrets</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        Stored in your system Keychain, protected by TouchID.
                    </p>
                </div>

                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                            Add Key
                        </button>
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
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] flex items-center justify-center mb-3">
                            <Lock className="w-5 h-5 text-muted-foreground/40" />
                        </div>
                        <p className="text-[12px] text-muted-foreground">No keys stored yet</p>
                    </div>
                )}

                {keys.map(key => (
                    <div key={key.id} className="group flex items-center justify-between p-3 rounded-lg border border-border hover:bg-foreground/[0.02] transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-md bg-foreground/[0.04]">
                                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                                <span className="text-[13px] font-medium text-foreground block truncate">{key.name}</span>
                                <span className="text-[10px] text-muted-foreground/50 font-mono">
                                    {key.id.slice(0, 8)}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors"
                                onClick={() => handleRevealSecret(key.name, key.key_reference)}
                                title="Reveal"
                            >
                                <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                                className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                onClick={() => handleDeleteKey(key.id, key.key_reference)}
                                title="Delete"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
