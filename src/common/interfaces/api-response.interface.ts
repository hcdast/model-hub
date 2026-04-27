export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
