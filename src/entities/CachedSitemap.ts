import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from "typeorm";

@Entity()
@Unique(['source', 'date'])
export class CachedSitemap {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    source: string;

    @Column()
    date: string; // YYYY-MM-DD format

    @Column("jsonb")
    urls: Array<{
        url: string;
        title?: string;
    }>;

    @CreateDateColumn()
    createdAt: Date;
} 