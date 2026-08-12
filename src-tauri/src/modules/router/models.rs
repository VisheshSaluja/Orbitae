use serde::{Deserialize, Serialize};

/// How a matched route should be handled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RouteHandler {
    /// Execute a tool directly and return structured data.
    Direct,
    /// Spawn a task-mode agent session with a pre-filled template prompt.
    Template,
}

/// A registered route in the semantic router.
#[derive(Debug, Clone)]
pub struct Route {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub handler: RouteHandler,
    pub examples: &'static [&'static str],
    /// Template prompt used when handler is Template.
    pub template_prompt: Option<&'static str>,
}

/// Result of classifying a user query against all routes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteMatch {
    pub route_id: String,
    pub route_name: String,
    pub confidence: f64,
    pub handler: RouteHandler,
}

/// Response from the `route_request` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RouteResponse {
    /// Route matched with high confidence; tool executed, data attached.
    Direct {
        route_id: String,
        route_name: String,
        confidence: f64,
        data: serde_json::Value,
    },
    /// Route matched a template; frontend should spawn a task session.
    Orchestrate {
        route_id: String,
        route_name: String,
        confidence: f64,
        suggested_prompt: String,
        template_id: Option<String>,
    },
    /// No route matched confidently; frontend should spawn a task session
    /// with the user's raw query as the prompt.
    Fallback {
        query: String,
        top_match: Option<RouteMatch>,
    },
}

/// Confidence thresholds for routing decisions.
pub const DIRECT_THRESHOLD: f64 = 0.40;
pub const ORCHESTRATE_THRESHOLD: f64 = 0.25;
