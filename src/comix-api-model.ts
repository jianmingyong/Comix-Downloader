export interface ComixChapterJson {
    items?: ComixChapterItem[];
    meta?: {
        from: number;
        hasNext: boolean;
        hasPrev: boolean;
        lastPage: number;
        page: number;
        perPage: number;
        to: number;
        total: number;
    };
}

export interface ComixChapterItem {
    createdAtFormatted: string;
    creator: {
        hashId: string;
        id: number;
        name: string;
        url: string;
        username: string;
    } | null;
    group: { id: number; name: string } | null;
    groupId: number | null;
    id: number;
    isOfficial: boolean;
    language: string;
    mangaId: number;
    name: string | null;
    number: number;
    url: string;
    volume: number;
    votes: number;
}

export interface ComixChapterPageJson {
    pages?: {
        items?: ComixChapterPageItem[];
    };
}

export interface ComixChapterPageItem {
    width: number;
    height: number;
    url: string;
    s?: number;
}
