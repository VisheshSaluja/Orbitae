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
    on_failure: string;
    max_retries: number;
    retry_delay_ms: number;
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

export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'aborted' | 'skipped';

export interface PlaybookRun {
    id: string;
    playbook_id: string;
    project_id: string;
    status: RunStatus;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
}

export interface StepRun {
    id: string;
    run_id: string;
    step_id: string;
    step_name: string;
    step_type: string;
    status: RunStatus;
    exit_code: number | null;
    stdout: string | null;
    stderr: string | null;
    started_at: string | null;
    finished_at: string | null;
    attempt: number;
}

export interface PlaybookRunWithSteps {
    run: PlaybookRun;
    steps: StepRun[];
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
    projectId: string;
    name: string;
    path: string;
    scripts?: ProjectScript[];
    knowledgeNodes?: KnowledgeNode[];
}

// Knowledge Graph
export interface KnowledgeNode {
    id: string;
    project_id: string;
    title: string;
    content: string;
    kind: string;
    source: string;
    status: string;
    tags: string;
    created_at: string;
    updated_at: string;
}

export interface KnowledgeEdge {
    id: string;
    from_node: string;
    to_node: string;
    relation: string;
    created_at: string;
}

export interface KnowledgeLogEntry {
    id: string;
    project_id: string;
    action: string;
    summary: string;
    affected_nodes: string;
    created_at: string;
}

export interface NodeWithEdges {
    node: KnowledgeNode;
    edges: KnowledgeEdge[];
}

// AI Agent Hub
export interface AiProviderInfo {
    id: string;
    name: string;
    models: AiModelInfo[];
    requires_api_key: boolean;
    default_base_url?: string;
}

export interface AiModelInfo {
    id: string;
    name: string;
    context_window: number;
    supports_tools: boolean;
}

export interface AiProviderConfig {
    id: string;
    project_id: string;
    provider: string;
    model: string;
    key_reference?: string;
    base_url?: string;
    temperature: number;
    max_tokens: number;
    is_default: number;
    created_at: string;
    updated_at: string;
}

export interface Conversation {
    id: string;
    project_id: string;
    title: string;
    provider: string;
    model: string;
    created_at: string;
    updated_at: string;
}

export interface ConversationMessage {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    tool_calls?: string;
    tool_results?: string;
    created_at: string;
}
