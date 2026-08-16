export interface Chunk {
  articleId: string;
  documentTitle: string;
  arlisId: number;
  ref: string;
  score: number;
  text: string;
  docType: string;
  actNumber: string | null;
}
