use std::collections::HashMap;
use super::models::{Route, RouteHandler, RouteMatch, DIRECT_THRESHOLD};

/// Pre-computed TF-IDF semantic router.
///
/// Routes are defined statically with example utterances. On construction,
/// the router tokenizes all examples, builds a vocabulary with IDF weights,
/// and computes a centroid TF-IDF vector per route. Classification is a
/// cosine similarity lookup — sub-millisecond, no ML model required.
pub struct SemanticRouter {
    routes: Vec<Route>,
    vocabulary: HashMap<String, usize>,
    idf: Vec<f64>,
    centroids: Vec<Vec<f64>>,
}

/// Thread-safe handle to the router, initialized once at app startup.
pub type RouterState = std::sync::Arc<SemanticRouter>;

/// Stop words filtered during tokenization.
///
/// Includes common question/command words ("what", "how", "show") that appear
/// across many routes and don't help discriminate intent.
const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "and", "but", "or",
    "not", "no", "so", "if", "then", "than", "too", "very", "just",
    "about", "up", "out", "it", "its", "i", "me", "my", "we", "our",
    "you", "your", "he", "she", "they", "them", "this", "that", "these",
    "those", "am", "any", "all", "each", "every", "some", "also",
    "what", "how", "show", "tell", "give", "want", "need", "please",
    "help", "check", "see", "get", "look", "let", "make", "know",
    "right", "now", "here", "there",
];

impl SemanticRouter {
    /// Build the router from static route definitions.
    pub fn new() -> Self {
        let routes = define_routes();
        let stop: std::collections::HashSet<&str> = STOP_WORDS.iter().copied().collect();

        let mut doc_freq: HashMap<String, usize> = HashMap::new();
        let mut vocabulary: HashMap<String, usize> = HashMap::new();
        let mut all_token_sets: Vec<Vec<Vec<String>>> = Vec::new();
        let mut total_docs = 0usize;

        for route in &routes {
            let mut route_tokens: Vec<Vec<String>> = Vec::new();
            for example in route.examples {
                let tokens = tokenize(example, &stop);
                for t in &tokens {
                    if !vocabulary.contains_key(t) {
                        let idx = vocabulary.len();
                        vocabulary.insert(t.clone(), idx);
                    }
                }
                route_tokens.push(tokens);
                total_docs += 1;
            }
            all_token_sets.push(route_tokens);
        }

        for route_tokens in &all_token_sets {
            for tokens in route_tokens {
                let unique: std::collections::HashSet<&String> = tokens.iter().collect();
                for t in unique {
                    *doc_freq.entry(t.clone()).or_insert(0) += 1;
                }
            }
        }

        let vocab_size = vocabulary.len();
        let mut idf = vec![0.0f64; vocab_size];
        for (term, &idx) in &vocabulary {
            let df = *doc_freq.get(term).unwrap_or(&0) as f64;
            idf[idx] = ((total_docs as f64) / (1.0 + df)).ln() + 1.0;
        }

        let mut centroids: Vec<Vec<f64>> = Vec::new();
        for route_tokens in &all_token_sets {
            let mut centroid = vec![0.0f64; vocab_size];
            let n = route_tokens.len() as f64;

            for tokens in route_tokens {
                let vec = tfidf_vector(tokens, &vocabulary, &idf, vocab_size);
                for (i, v) in vec.iter().enumerate() {
                    centroid[i] += v / n;
                }
            }

            let norm = centroid.iter().map(|x| x * x).sum::<f64>().sqrt();
            if norm > 0.0 {
                for v in &mut centroid {
                    *v /= norm;
                }
            }
            centroids.push(centroid);
        }

        Self { routes, vocabulary, idf, centroids }
    }

    /// Classify a user query against all routes. Returns the best match.
    pub fn classify(&self, query: &str) -> Option<RouteMatch> {
        let stop: std::collections::HashSet<&str> = STOP_WORDS.iter().copied().collect();
        let tokens = tokenize(query, &stop);

        if tokens.is_empty() {
            return None;
        }

        let query_vec = tfidf_vector(&tokens, &self.vocabulary, &self.idf, self.vocabulary.len());
        let query_norm = query_vec.iter().map(|x| x * x).sum::<f64>().sqrt();

        if query_norm == 0.0 {
            return None;
        }

        let mut best_score = -1.0f64;
        let mut best_idx = 0usize;

        for (i, centroid) in self.centroids.iter().enumerate() {
            let dot: f64 = query_vec.iter().zip(centroid.iter()).map(|(a, b)| a * b).sum();
            let score = dot / query_norm;
            if score > best_score {
                best_score = score;
                best_idx = i;
            }
        }

        if best_score < DIRECT_THRESHOLD * 0.5 {
            return None;
        }

        let route = &self.routes[best_idx];
        Some(RouteMatch {
            route_id: route.id.to_string(),
            route_name: route.name.to_string(),
            confidence: best_score,
            handler: route.handler.clone(),
        })
    }

    /// Get a route by ID.
    pub fn get_route(&self, id: &str) -> Option<&Route> {
        self.routes.iter().find(|r| r.id == id)
    }
}

/// Tokenize text: lowercase, split on non-alphanumeric, remove stop words.
fn tokenize(text: &str, stop_words: &std::collections::HashSet<&str>) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 1 && !stop_words.contains(w))
        .map(|w| w.to_string())
        .collect()
}

/// Compute a TF-IDF vector for a token list.
fn tfidf_vector(
    tokens: &[String],
    vocabulary: &HashMap<String, usize>,
    idf: &[f64],
    vocab_size: usize,
) -> Vec<f64> {
    let mut tf: HashMap<&String, f64> = HashMap::new();
    let n = tokens.len() as f64;
    for t in tokens {
        *tf.entry(t).or_insert(0.0) += 1.0 / n;
    }

    let mut vec = vec![0.0f64; vocab_size];
    for (term, &freq) in &tf {
        if let Some(&idx) = vocabulary.get(*term) {
            vec[idx] = freq * idf[idx];
        }
    }
    vec
}

/// Static route definitions.
fn define_routes() -> Vec<Route> {
    vec![
        Route {
            id: "git_status",
            name: "Git Status",
            description: "Check current branch, modified files, and sync status",
            handler: RouteHandler::Direct,
            examples: &[
                "git status",
                "git branch",
                "git branch status",
                "current branch",
                "uncommitted changes",
                "staged files",
                "unstaged modifications",
                "dirty working tree",
            ],
            template_prompt: None,
        },
        Route {
            id: "git_changes",
            name: "Recent Changes",
            description: "Show file diff stats and recently modified files",
            handler: RouteHandler::Direct,
            examples: &[
                "git diff",
                "git changes",
                "diff stats",
                "changed files",
                "modified files",
                "recent changes",
                "lines added removed",
                "file modifications",
            ],
            template_prompt: None,
        },
        Route {
            id: "listening_ports",
            name: "Listening Ports",
            description: "Scan for TCP ports currently in use",
            handler: RouteHandler::Direct,
            examples: &[
                "listening ports",
                "open ports",
                "running services",
                "port scan",
                "localhost ports",
                "tcp connections",
                "active ports",
                "port 3000",
                "port 8080",
            ],
            template_prompt: None,
        },
        Route {
            id: "project_context",
            name: "Project Context",
            description: "Preview the context document assembled for agents",
            handler: RouteHandler::Direct,
            examples: &[
                "project context",
                "agent context preview",
                "context document",
                "injected context",
                "context assembled",
                "preview agent prompt",
            ],
            template_prompt: None,
        },
        Route {
            id: "active_sessions",
            name: "Active Sessions",
            description: "List currently running agent sessions",
            handler: RouteHandler::Direct,
            examples: &[
                "active sessions",
                "running agents",
                "list sessions",
                "session status",
                "agent sessions",
                "running tasks",
            ],
            template_prompt: None,
        },
        Route {
            id: "boot_environment",
            name: "Boot Dev Environment",
            description: "Start all services for local development",
            handler: RouteHandler::Template,
            examples: &[
                "start dev environment",
                "boot services",
                "launch dev server",
                "spin up environment",
                "initialize development",
                "start app",
                "run dev",
                "npm start",
            ],
            template_prompt: Some(
                "Analyze this project and start the complete development environment. \
                 Look at the scripts, identify the correct startup order (databases first, \
                 then backends, then frontends), and use the appropriate commands. \
                 Wait for each service to be ready before starting dependent ones."
            ),
        },
        Route {
            id: "debug_error",
            name: "Debug Error",
            description: "Diagnose and fix a bug or error",
            handler: RouteHandler::Template,
            examples: &[
                "debug error",
                "fix bug",
                "diagnose issue",
                "troubleshoot crash",
                "error failing",
                "investigate bug",
                "broken build",
                "stack trace",
            ],
            template_prompt: Some(
                "I need help debugging an issue. Check the git status, look at active \
                 processes, and query any relevant knowledge nodes about recent debugging. \
                 Help me identify the root cause and suggest a fix."
            ),
        },
        Route {
            id: "explain_codebase",
            name: "Explain Codebase",
            description: "Get an overview of the project structure and architecture",
            handler: RouteHandler::Template,
            examples: &[
                "explain codebase",
                "codebase overview",
                "project architecture",
                "tech stack",
                "repo overview",
                "repository structure",
                "code walkthrough",
                "project structure",
                "folder layout",
            ],
            template_prompt: Some(
                "Using the project context provided plus the actual scripts and docs, \
                 give me a concise overview of this codebase: what tech stack it uses, \
                 how it's structured, and how to get started."
            ),
        },
        Route {
            id: "status_check",
            name: "Status Check",
            description: "Full health check of project services and state",
            handler: RouteHandler::Template,
            examples: &[
                "status report",
                "health check",
                "system health",
                "everything running",
                "full status",
                "project health",
                "service status",
            ],
            template_prompt: Some(
                "Give me a full status check of this project. Check git status, \
                 list all active processes, and review the project context and notes \
                 for any recent issues. Summarize the current state."
            ),
        },
        Route {
            id: "generate_playbook",
            name: "Generate Playbook",
            description: "Create a reusable startup playbook from project scripts",
            handler: RouteHandler::Template,
            examples: &[
                "generate playbook",
                "create runbook",
                "automate startup",
                "playbook scripts",
                "create automation",
                "startup script",
            ],
            template_prompt: Some(
                "Analyze the project scripts and create a Playbook that automates \
                 the startup sequence. Identify the correct order, add appropriate \
                 delays between steps, and save it so I can one-click start this \
                 project in the future."
            ),
        },
        Route {
            id: "document_convention",
            name: "Document Convention",
            description: "Save a development convention to the knowledge graph",
            handler: RouteHandler::Template,
            examples: &[
                "document convention",
                "save convention",
                "coding convention",
                "team convention",
                "best practice",
                "coding standard",
                "coding rule",
            ],
            template_prompt: Some(
                "I want to document a development convention for this project. \
                 Ask me what the convention is, then record it in the project's \
                 conventions documentation (CLAUDE.md or a file under docs/) so the \
                 team and future agents can reference it."
            ),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn router_classifies_git_status() {
        let router = SemanticRouter::new();
        let result = router.classify("git status").unwrap();
        assert_eq!(result.route_id, "git_status");
        assert!(result.confidence > 0.3);
    }

    #[test]
    fn router_classifies_git_status_natural() {
        let router = SemanticRouter::new();
        let result = router.classify("current branch status").unwrap();
        assert_eq!(result.route_id, "git_status");
    }

    #[test]
    fn router_classifies_ports() {
        let router = SemanticRouter::new();
        let result = router.classify("listening ports").unwrap();
        assert_eq!(result.route_id, "listening_ports");
    }

    #[test]
    fn router_classifies_debug() {
        let router = SemanticRouter::new();
        let result = router.classify("debug this error").unwrap();
        assert_eq!(result.route_id, "debug_error");
    }

    #[test]
    fn router_classifies_boot() {
        let router = SemanticRouter::new();
        let result = router.classify("start dev environment").unwrap();
        assert_eq!(result.route_id, "boot_environment");
    }

    #[test]
    fn router_returns_none_for_gibberish() {
        let router = SemanticRouter::new();
        let result = router.classify("xyzzy plugh");
        assert!(result.is_none() || result.unwrap().confidence < 0.2);
    }

    #[test]
    fn router_classifies_explain() {
        let router = SemanticRouter::new();
        let result = router.classify("explain the codebase").unwrap();
        assert_eq!(result.route_id, "explain_codebase");
    }

    #[test]
    fn router_classifies_explain_repo() {
        let router = SemanticRouter::new();
        let result = router.classify("what is this repo about").unwrap();
        assert_eq!(result.route_id, "explain_codebase");
    }

    #[test]
    fn router_classifies_diff() {
        let router = SemanticRouter::new();
        let result = router.classify("recent file changes").unwrap();
        assert_eq!(result.route_id, "git_changes");
    }

    #[test]
    fn router_classifies_playbook() {
        let router = SemanticRouter::new();
        let result = router.classify("generate a playbook").unwrap();
        assert_eq!(result.route_id, "generate_playbook");
    }

    #[test]
    fn direct_routes_have_no_template() {
        let router = SemanticRouter::new();
        let route = router.get_route("git_status").unwrap();
        assert!(route.template_prompt.is_none());
    }

    #[test]
    fn template_routes_have_prompt() {
        let router = SemanticRouter::new();
        let route = router.get_route("boot_environment").unwrap();
        assert!(route.template_prompt.is_some());
    }

}
