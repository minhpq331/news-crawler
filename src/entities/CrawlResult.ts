import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from "typeorm";

@Entity()
@Unique(['source'])
export class CrawlResult {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    source: string;

    @Column("jsonb")
    results: Array<{
        title: string;
        url: string;
        reactions: number;
        comments: number;
    }>;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
} 