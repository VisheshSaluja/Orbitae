export interface Project {
    id: string;
    name: string;
    path: string;
    ssh_key_path?: string;
    notes?: string;
    settings?: string; // JSON string
    created_at: string;
    updated_at: string;
}

export interface SshHostModel {
    host: string;
    hostname: string;
    user?: string;
    port?: number;
    identity_file?: string;
}

export interface Snippet {
    id: string;
    project_id: string;
    label: string;
    command: string;
    description?: string;
}

export interface ProjectKey {
    id: string;
    project_id: string;
    name: string;
    key_reference: string;
    created_at: string;
}

export interface ProjectNote {
    id: string;
    project_id: string;
    title: string;
    content: string;
    color: string;
    kind: 'text' | 'canvas';
    created_at: string;
    updated_at: string;
}

export interface ProjectSettings {
    note_labels: Record<string, string>;
}

export interface Commit {
    hash: string;
    parents: string[];
    author: string;
    date: string;
    message: string;
    refs: string;
}

export interface GitStatus {
    branch: string;
    modified_count: number;
    ahead: number;
    behind: number;
    remote_url?: string;
}

export interface ProjectConnection {
    id: string;
    project_id: string;
    name: string;
    kind: 'postgres' | 'mysql' | 'sqlite';
    details: string; // JSON string
    created_at: string;
    updated_at: string;
}

export interface Process {
    id: string;
    command: string;
    cwd: string;
    running: boolean;
    pid: number;
}

export interface ProjectPlaybook {
    id: string;
    project_id: string;
    name: string;
    description?: string;
    created_at: string;
    updated_at: string;
}

export interface PlaybookStep {
    id: string;
    playbook_id: string;
    name: string;
    type: string;
    command?: string;
    depends_on?: string;
    expected_output?: string;
    created_at: string;
    updated_at: string;
}

export interface ProjectScript {
    name: string;
    command: string;
    source: string;
}

export interface ProjectLink {
    id: string;
    project_id: string;
    title: string;
    url: string;
    icon?: string;
    kind: 'url' | 'command' | 'repository';
    working_directory?: string;
    created_at: string;
}

export interface QueryResult {
    columns: string[];
    rows: string[][];
    affected_rows: number;
}

export interface TableInfo {
    name: string;
    schema?: string;
}

export interface ProjectContext {
    name: string;
    path: string;
    scripts?: ProjectScript[];
}
