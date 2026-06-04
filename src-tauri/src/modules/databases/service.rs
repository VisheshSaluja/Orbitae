use super::models::{ProjectConnection, TableInfo, QueryResult};
use super::repository::DatabaseRepository;
use anyhow::Result;
use sqlx::SqlitePool;
use crate::modules::vault::service::VaultService;

/// Service name used to namespace database passwords in the OS keychain.
const VAULT_SERVICE_NAME: &str = "orbitae-db-passwords";

// We need an enum to hold different pool types
pub enum DbPool {
    Sqlite(sqlx::SqlitePool),
    Postgres(sqlx::PgPool),
    MySql(sqlx::MySqlPool),
}

pub struct DatabaseService {
    repo: DatabaseRepository,
}

impl DatabaseService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: DatabaseRepository::new(pool),
        }
    }

    /// Creates a VaultService instance scoped to database passwords.
    fn vault() -> VaultService {
        VaultService::new(VAULT_SERVICE_NAME)
    }

    /// Stores a database connection password in the OS keychain, keyed by connection ID.
    pub fn store_password(connection_id: &str, password: &str) -> Result<()> {
        Self::vault().store_secret(connection_id, password)
    }

    /// Retrieves a database connection password from the OS keychain.
    /// Returns `None` if no password is stored for this connection.
    pub fn get_password(connection_id: &str) -> Option<String> {
        Self::vault().get_secret(connection_id).ok()
    }

    /// Deletes a database connection password from the OS keychain.
    /// Silently succeeds if no password exists for this connection.
    pub fn delete_password(connection_id: &str) {
        let _ = Self::vault().delete_secret(connection_id);
    }

    pub async fn create_connection(&self, project_id: String, name: String, kind: String, details: String) -> Result<ProjectConnection> {
        self.repo.create_connection(project_id, name, kind, details).await
    }

    pub async fn get_connections(&self, project_id: &str) -> Result<Vec<ProjectConnection>> {
        self.repo.get_connections(project_id).await
    }

    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        self.repo.delete_connection(id).await
    }

    /// Tests a database connection using the provided details and password.
    /// The password must come from the caller (vault lookup or user input) — never from the details JSON.
    pub async fn test_connection(&self, kind: &str, details: &str, password: Option<&str>) -> Result<bool> {
        let config: serde_json::Value = serde_json::from_str(details)?;
        let pass = password.unwrap_or("");

        match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;

                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");

                let options = PgConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::PgPool::connect_with(options).await?;
                pool.close().await;
                Ok(true)
            },
            "mysql" => {
                use sqlx::mysql::MySqlConnectOptions;

                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(3306) as u16;
                let user = config["username"].as_str().unwrap_or("root");
                let db_name = config["database"].as_str().unwrap_or("mysql");

                let options = MySqlConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::MySqlPool::connect_with(options).await?;
                pool.close().await;
                Ok(true)
            },
            "sqlite" => {
                use sqlx::sqlite::SqliteConnectOptions;
                use std::str::FromStr;

                let path = config["file_path"].as_str().ok_or(anyhow::anyhow!("Missing file_path"))?;
                let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path))?;

                let pool = sqlx::SqlitePool::connect_with(options).await?;
                pool.close().await;
                Ok(true)
            },
            _ => Err(anyhow::anyhow!("Unsupported database type")),
        }
    }

    /// Executes a read-only query against a database connection.
    /// The password must come from the caller (vault lookup or user input) — never from the details JSON.
    pub async fn execute_query(&self, kind: &str, details: &str, query: &str, password: Option<&str>) -> Result<QueryResult> {
         validate_query(query)?;
         let config: serde_json::Value = serde_json::from_str(details)?;
         let pass = password.unwrap_or("");

         match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;
                use sqlx::Row;
                use sqlx::Column;

                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");

                let options = PgConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::PgPool::connect_with(options).await?;
                let rows = sqlx::query(query).fetch_all(&pool).await?;

                let mut columns = Vec::new();
                if let Some(first) = rows.first() {
                    for col in first.columns() {
                        columns.push(col.name().to_string());
                    }
                }

                let mut result_rows = Vec::new();
                for row in rows {
                    let mut values = Vec::new();
                    for col_name in &columns {
                        let val_str: String = row.try_get(col_name.as_str()).unwrap_or_else(|_| "NULL".to_string());
                        values.push(serde_json::Value::String(val_str));
                    }
                    result_rows.push(values);
                }

                pool.close().await;

                Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows: 0,
                })
            },
             "sqlite" => {
                use sqlx::sqlite::SqliteConnectOptions;
                use sqlx::Row;
                use sqlx::Column;
                use std::str::FromStr;

                let path = config["file_path"].as_str().ok_or(anyhow::anyhow!("Missing file_path"))?;
                let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path))?;

                let pool = sqlx::SqlitePool::connect_with(options).await?;
                let rows = sqlx::query(query).fetch_all(&pool).await?;

                let mut columns = Vec::new();
                if let Some(first) = rows.first() {
                    for col in first.columns() {
                        columns.push(col.name().to_string());
                    }
                }

                let mut result_rows = Vec::new();
                for row in rows {
                    let mut values = Vec::new();
                    for col_name in &columns {
                        let val_str: String = row.try_get(col_name.as_str()).unwrap_or_else(|_| "NULL".to_string());
                        values.push(serde_json::Value::String(val_str));
                    }
                    result_rows.push(values);
                }

                pool.close().await;
                Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows: 0,
                })
             },
             _ => Err(anyhow::anyhow!("Query execution for {} not implemented yet", kind)),
         }
    }

    /// Retrieves the list of tables from a database connection.
    /// The password must come from the caller (vault lookup or user input) — never from the details JSON.
    pub async fn get_tables(&self, kind: &str, details: &str, password: Option<&str>) -> Result<Vec<TableInfo>> {
        let config: serde_json::Value = serde_json::from_str(details)?;
        let pass = password.unwrap_or("");

        match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;
                use sqlx::Row;

                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");

                let options = PgConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::PgPool::connect_with(options).await?;

                let query = "
                    SELECT table_name, table_schema
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY table_name
                ";

                let rows = sqlx::query(query).fetch_all(&pool).await?;

                let mut tables = Vec::new();
                for row in rows {
                    let name: String = row.try_get("table_name")?;
                    let schema: String = row.try_get("table_schema")?;
                    tables.push(TableInfo { name, schema: Some(schema) });
                }

                pool.close().await;
                Ok(tables)
            },
            "sqlite" => {
                use sqlx::sqlite::SqliteConnectOptions;
                use sqlx::Row;
                use std::str::FromStr;

                let path = config["file_path"].as_str().ok_or(anyhow::anyhow!("Missing file_path"))?;
                let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path))?;

                let pool = sqlx::SqlitePool::connect_with(options).await?;

                let query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
                let rows = sqlx::query(query).fetch_all(&pool).await?;

                let mut tables = Vec::new();
                for row in rows {
                    let name: String = row.try_get("name")?;
                    tables.push(TableInfo { name, schema: None });
                }

                pool.close().await;
                Ok(tables)
            },
            "mysql" => {
                use sqlx::mysql::MySqlConnectOptions;
                use sqlx::Row;

                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(3306) as u16;
                let user = config["username"].as_str().unwrap_or("root");
                let db_name = config["database"].as_str().unwrap_or("mysql");

                let options = MySqlConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::MySqlPool::connect_with(options).await?;

                let rows = sqlx::query("SHOW TABLES").fetch_all(&pool).await?;

                let mut tables = Vec::new();
                for row in rows {
                    let name: String = row.try_get(0)?;
                    tables.push(TableInfo { name, schema: None });
                }

                pool.close().await;
                Ok(tables)
            },
            _ => Err(anyhow::anyhow!("Get tables for {} not implemented yet", kind)),
        }
    }
}

fn validate_query(query: &str) -> Result<()> {
    let stripped = strip_sql_comments(query);
    let normalized = stripped.trim();

    if normalized.is_empty() {
        return Err(anyhow::anyhow!("Query cannot be empty"));
    }

    // Block multiple statements (semicolons mid-query enable stacked injection)
    let without_trailing = normalized.trim_end_matches(';').trim();
    if without_trailing.contains(';') {
        return Err(anyhow::anyhow!(
            "Multiple statements are not allowed. Submit one query at a time."
        ));
    }

    let upper = without_trailing.to_uppercase();
    let allowed_prefixes = ["SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "PRAGMA", "WITH"];
    let starts_with_allowed = allowed_prefixes.iter().any(|p| {
        upper.starts_with(p) && upper[p.len()..].starts_with(|c: char| c.is_whitespace() || c == '(')
    });

    if !starts_with_allowed {
        return Err(anyhow::anyhow!(
            "Only read-only queries are allowed (SELECT, EXPLAIN, SHOW, DESCRIBE, WITH...SELECT)."
        ));
    }

    // WITH CTEs must resolve to SELECT, not INSERT/UPDATE/DELETE
    if upper.starts_with("WITH") {
        let dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE"];
        for keyword in &dangerous {
            if upper.contains(keyword) {
                let before_keyword = &upper[..upper.find(keyword).unwrap()];
                let paren_depth: i32 = before_keyword.chars().map(|c| match c {
                    '(' => 1, ')' => -1, _ => 0
                }).sum();
                // If keyword appears at top-level (not inside a subquery), block it
                if paren_depth <= 0 {
                    return Err(anyhow::anyhow!(
                        "WITH expressions must resolve to SELECT. '{}' is not allowed.",
                        keyword
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Strip SQL line comments (--) and block comments (/* */) to prevent validation bypass.
fn strip_sql_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if i + 1 < len && chars[i] == '-' && chars[i + 1] == '-' {
            while i < len && chars[i] != '\n' {
                i += 1;
            }
        } else if i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2; // skip */
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_select_queries() {
        assert!(validate_query("SELECT * FROM users").is_ok());
        assert!(validate_query("SELECT id, name FROM projects WHERE id = 1").is_ok());
        assert!(validate_query("select count(*) from items;").is_ok());
    }

    #[test]
    fn allows_explain_show_describe() {
        assert!(validate_query("EXPLAIN SELECT 1").is_ok());
        assert!(validate_query("SHOW TABLES").is_ok());
        assert!(validate_query("DESCRIBE users").is_ok());
        assert!(validate_query("PRAGMA table_info(users)").is_ok());
    }

    #[test]
    fn blocks_destructive_statements() {
        assert!(validate_query("INSERT INTO users VALUES (1)").is_err());
        assert!(validate_query("UPDATE users SET name = 'x'").is_err());
        assert!(validate_query("DELETE FROM users").is_err());
        assert!(validate_query("DROP TABLE users").is_err());
        assert!(validate_query("ALTER TABLE users ADD col INT").is_err());
        assert!(validate_query("TRUNCATE users").is_err());
        assert!(validate_query("CREATE TABLE evil (id INT)").is_err());
    }

    #[test]
    fn blocks_multi_statement_injection() {
        assert!(validate_query("SELECT 1; DROP TABLE users").is_err());
        assert!(validate_query("SELECT 1; DELETE FROM users").is_err());
    }

    #[test]
    fn blocks_comment_bypass() {
        assert!(validate_query("-- comment\nDROP TABLE users").is_err());
        assert!(validate_query("/* comment */ INSERT INTO users VALUES (1)").is_err());
    }

    #[test]
    fn blocks_cte_with_destructive_action() {
        assert!(validate_query("WITH x AS (SELECT 1) DELETE FROM users").is_err());
        assert!(validate_query("WITH x AS (SELECT 1) INSERT INTO users VALUES (1)").is_err());
    }

    #[test]
    fn allows_cte_with_select() {
        assert!(validate_query("WITH cte AS (SELECT id FROM users) SELECT * FROM cte").is_ok());
    }

    #[test]
    fn blocks_empty_query() {
        assert!(validate_query("").is_err());
        assert!(validate_query("   ").is_err());
    }

    #[test]
    fn strips_sql_comments_correctly() {
        assert_eq!(strip_sql_comments("SELECT -- comment\n1"), "SELECT \n1");
        assert_eq!(strip_sql_comments("SELECT /* block */ 1"), "SELECT  1");
        assert_eq!(strip_sql_comments("/* start */DROP TABLE x"), "DROP TABLE x");
    }
}
