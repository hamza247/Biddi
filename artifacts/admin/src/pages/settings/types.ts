export type FieldKind =
  | "text"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "secret"
  | "select"
  | "textarea";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  help?: string;
  placeholder?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Render the field on its own row spanning the full width. Default false. */
  fullWidth?: boolean;
}

export interface SectionDef {
  title?: string;
  description?: string;
  fields: FieldDef[];
}

export interface TabSettingsResponse {
  tab: string;
  settings: Record<string, string | number | boolean>;
  _hasSecrets: Record<string, boolean>;
}
