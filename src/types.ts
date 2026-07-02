export interface Column {
  name: string;
  path: string;
  pii?: boolean;
}

export interface SelectClause {
  column?: Column[];
  forEach?: string;
  select?: SelectClause[];
}

export interface WhereClause {
  path: string;
}

export interface ViewDefinition {
  name: string;
  resource: string;
  select: SelectClause[];
  where?: WhereClause[];
}

export type Row = Record<string, unknown>;
