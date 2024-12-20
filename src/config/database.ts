import { DataSource } from "typeorm";
import { CrawlResult } from "../entities/CrawlResult";
import { CachedSitemap } from "../entities/CachedSitemap";
import { CachedArticle } from "../entities/CachedArticle";

export const AppDataSource = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "news_crawler",
    synchronize: true, // To make the deployment simpler, I set synchronize to true to make the database schema match the entities
    logging: false,
    entities: [CrawlResult, CachedSitemap, CachedArticle],
    subscribers: [],
    migrations: [],
}); 