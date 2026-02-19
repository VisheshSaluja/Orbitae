
export interface Project {
    id: string;
    name: string;
    path: string;
    settings?: string;
    created_at?: string;
    updated_at?: string;
}

export interface ProjectNote {
    id: string;
    title: string;
    content: string;
    color: string;
    created_at: string;
    updated_at?: string;
    kind?: 'text' | 'canvas';
}

export interface GitStatus {
    branch: string;
    modified_count: number;
    ahead: number;
    behind: number;
    remote_url?: string;
}

export interface Commit {
    hash: string;
    message: string;
    author: string;
    date: string;
    parents: string[];
    refs?: string;
}

export interface ProjectConnection {
    id: string;
    name: string;
    kind: 'postgres' | 'mysql' | 'sqlite';
    details: string;
}

export interface ProjectSettings {
    note_labels?: Record<string, string>;
}

export interface ProjectKey {
    id: string;
    name: string;
    key_reference: string;
    created_at?: string;
}
