import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from "typeorm";

@Entity()
@Unique(['source', 'articleId'])
export class CachedArticle {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    source: string;

    @Column()
    articleId: string;

    @Column()
    title: string;

    @Column()
    url: string;

    @Column()
    type: number;

    @CreateDateColumn()
    createdAt: Date;
} 