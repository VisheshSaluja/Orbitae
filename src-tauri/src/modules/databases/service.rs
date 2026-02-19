use super::models::{ProjectConnection, TableInfo, QueryResult};
use super::repository::DatabaseRepository;
use anyhow::Result;
use sqlx::SqlitePool;
// We will need dynamic dispatch or enum for different pools
// For now, let's assume we handle connection testing and simple queries via specialized separate pools created on fly or cached.
// Caching pools is complex in rust without global state or heavy Arc<Mutex>. 
// Let's start with CREATE-USE-DISPOSE for simplicity or a simple DashMap if we can add dependencies.
// Actually, Tauri State is perfect for this.

// But wait, sqlx pools are expensive to create.
// For the MVP, let's just create a pool, run the query, and close it. 
// Optimization: Keep a map in a Mutex wrapper managed by Tauri.



// We need an enum to hold different pool types
pub enum DbPool {
    Sqlite(sqlx::SqlitePool),
    Postgres(sqlx::PgPool),
    MySql(sqlx::MySqlPool),
}

pub struct DatabaseService {
    repo: DatabaseRepository,
    // This would be injected or managed. For now, since service is transient in our commands (re-created), 
    // we can't easily hold state HERE. State must be passed from AppHandle.
    // So Service should probably take the ConnectionManager State.
}

impl DatabaseService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: DatabaseRepository::new(pool),
        }
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

    // Connection Logic
    // We will parse the "details" JSON
    pub async fn test_connection(&self, kind: &str, details: &str, password: Option<&str>) -> Result<bool> {
        let config: serde_json::Value = serde_json::from_str(details)?;
        
        match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;

                
                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");
                let config_pass = config["password"].as_str().unwrap_or("");
                let pass = password.unwrap_or(config_pass);

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
                let config_pass = config["password"].as_str().unwrap_or("");
                let pass = password.unwrap_or(config_pass);

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

    pub async fn execute_query(&self, kind: &str, details: &str, query: &str, password: Option<&str>) -> Result<QueryResult> {
         let config: serde_json::Value = serde_json::from_str(details)?;
         
         match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;
                use sqlx::Row;
                use sqlx::Column;
                
                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");
                let config_pass = config["password"].as_str().unwrap_or("");
                let pass = password.unwrap_or(config_pass);

                let options = PgConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(user)
                    .password(pass)
                    .database(db_name);

                let pool = sqlx::PgPool::connect_with(options).await?;
                // Simple execution of fetching all rows
                // This is risky for large tables, should limit.
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
                    affected_rows: 0, // Fetch doesn't usually give affected
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

    pub async fn get_tables(&self, kind: &str, details: &str, password: Option<&str>) -> Result<Vec<TableInfo>> {
        let config: serde_json::Value = serde_json::from_str(details)?;
        
        match kind {
            "postgres" => {
                use sqlx::postgres::PgConnectOptions;
                use sqlx::Row;
                
                let host = config["host"].as_str().unwrap_or("localhost");
                let port = config["port"].as_u64().unwrap_or(5432) as u16;
                let user = config["username"].as_str().unwrap_or("postgres");
                let db_name = config["database"].as_str().unwrap_or("postgres");
                let config_pass = config["password"].as_str().unwrap_or("");
                let pass = password.unwrap_or(config_pass);
                
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
                 let config_pass = config["password"].as_str().unwrap_or("");
                 let pass = password.unwrap_or(config_pass);
 
                 let options = MySqlConnectOptions::new()
                     .host(host)
                     .port(port)
                     .username(user)
                     .password(pass)
                     .database(db_name);
 
                 let pool = sqlx::MySqlPool::connect_with(options).await?;
                 
                 // Show tables in the connected database
                 let rows = sqlx::query("SHOW TABLES").fetch_all(&pool).await?;
                 
                 let mut tables = Vec::new();
                 for row in rows {
                     // SHOW TABLES returns a column typically named "Tables_in_dbname" but index 0 is safer
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

