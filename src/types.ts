export interface Column {
  name: string;
  path: string;
  /** Return every value as an array instead of requiring at most one. */
  collection?: boolean;
  pii?: boolean;
}

export interface SelectClause {
  column?: Column[];
  select?: SelectClause[];
  unionAll?: SelectClause[];
  forEach?: string;
  forEachOrNull?: string;
  repeat?: string[];
}

export interface WhereClause {
  path: string;
}

/** A ViewDefinition constant: `name` plus one `value[x]` field. */
export interface Constant {
  name: string;
  [valueX: string]: unknown;
}

export interface ViewDefinition {
  resourceType?: 'ViewDefinition';
  status?: string;
  name: string;
  resource: string;
  constant?: Constant[];
  select: SelectClause[];
  where?: WhereClause[];
}

export type Row = Record<string, unknown>;
