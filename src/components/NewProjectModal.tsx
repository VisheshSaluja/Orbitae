import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Github, Sparkles } from 'lucide-react';
import { invokeCommand } from '../lib/tauri';
import { toast } from 'sonner';
import type { Project } from '../types';

interface GitInitResult {
    used_fallback_identity: boolean;
}

interface GhStatus {
    installed: boolean;
    authenticated: boolean;
}

interface NewProjectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Fires once the project + git repo (+ optional GitHub repo) are ready.
     *  `description` is handed back so the caller can send it as the first
     *  chat message — onboarding and the first plan are the same flow. */
    onCreated: (project: Project, description: string) => void;
}

// Deliberately tiny — the point is a reasonable default folder/name, not a
// clever NLP pass. The user can always edit the path before starting.
const STOPWORDS = new Set([
    'a', 'an', 'the', 'app', 'application', 'tool', 'project', 'build',
    'create', 'make', 'simple', 'basic', 'my', 'new', 'website', 'web',
]);

function deriveSlug(description: string): string {
    const words = description
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .split(/\s+/)
        .filter((w) => w && !STOPWORDS.has(w));
    const picked = words.slice(0, 4);
    return picked.join('-') || 'new-project';
}

function titleCase(slug: string): string {
    return slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'New Project';
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ open, onOpenChange, onCreated }) => {
    const [description, setDescription] = useState('');
    const [path, setPath] = useState('');
    const [pathTouched, setPathTouched] = useState(false);
    const [wantsGithub, setWantsGithub] = useState(false);
    const [ghStatus, setGhStatus] = useState<GhStatus | null>(null);
    const [creating, setCreating] = useState(false);

    const slug = useMemo(() => deriveSlug(description), [description]);

    // Auto-fill the path from the description until the user edits it directly.
    useEffect(() => {
        if (!pathTouched) setPath(`~/projects/${slug}`);
    }, [slug, pathTouched]);

    // Reset on open, and check for `gh` once so the checkbox never lies about
    // being available.
    useEffect(() => {
        if (!open) return;
        setDescription('');
        setPath('~/projects/new-project');
        setPathTouched(false);
        setWantsGithub(false);
        setGhStatus(null);
        invokeCommand<GhStatus>('check_gh_status').then(setGhStatus).catch(() => setGhStatus({ installed: false, authenticated: false }));
    }, [open]);

    const ghAvailable = ghStatus?.installed && ghStatus?.authenticated;

    const handleStart = async () => {
        if (!description.trim()) {
            toast.error('Describe what you want to build first');
            return;
        }
        setCreating(true);
        try {
            const name = titleCase(slug);
            const project = await invokeCommand<Project>('create_project', { name, path });

            const gitResult = await invokeCommand<GitInitResult>('git_init', { path });
            if (gitResult.used_fallback_identity) {
                toast.info('No git identity was configured — set a local placeholder for this repo. Update it with `git config user.name/email` whenever you like.');
            }

            if (wantsGithub && ghAvailable) {
                try {
                    await invokeCommand<string>('create_github_repo', { path, name: slug, private: true });
                    toast.success('GitHub repo created and pushed');
                } catch (e) {
                    toast.error(`Project created, but the GitHub repo failed: ${e}`);
                }
            }

            onCreated(project, description.trim());
            onOpenChange(false);
        } catch (e) {
            toast.error(`Couldn't create the project: ${e}`);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400" /> Start from an idea
                    </DialogTitle>
                    <DialogDescription>
                        Describe what you want to build — the agent scaffolds it from here.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label>What do you want to build?</Label>
                        <Textarea
                            autoFocus
                            placeholder="a pomodoro timer app"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Will create at</Label>
                        <Input
                            value={path}
                            onChange={(e) => { setPath(e.target.value); setPathTouched(true); }}
                            className="font-mono text-xs"
                        />
                    </div>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={wantsGithub}
                            disabled={!ghAvailable}
                            onChange={(e) => setWantsGithub(e.target.checked)}
                            className="mt-0.5"
                        />
                        <span className={!ghAvailable ? 'text-muted-foreground' : ''}>
                            <span className="flex items-center gap-1.5"><Github className="w-3.5 h-3.5" /> Also create a GitHub repo</span>
                            {ghStatus && !ghAvailable && (
                                <span className="block text-[11px] text-muted-foreground/70 mt-0.5">
                                    {ghStatus.installed
                                        ? 'Run `gh auth login` to enable this.'
                                        : 'Install the GitHub CLI (`gh`) to enable this.'}
                                </span>
                            )}
                        </span>
                    </label>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
                    <Button onClick={handleStart} disabled={creating || !description.trim()}>
                        {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting…</> : 'Start building →'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
