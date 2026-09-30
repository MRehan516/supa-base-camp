export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audits: {
        Row: {
          created_at: string
          duration_ms: number
          element_count: number
          html_source: string
          id: string
          project_id: string | null
          score: number
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          element_count?: number
          html_source: string
          id?: string
          project_id?: string | null
          score?: number
        }
        Update: {
          created_at?: string
          duration_ms?: number
          element_count?: number
          html_source?: string
          id?: string
          project_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "audits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_examples: {
        Row: {
          created_at: string
          dataset: string
          id: string
          label: string
          text: string
        }
        Insert: {
          created_at?: string
          dataset: string
          id?: string
          label: string
          text: string
        }
        Update: {
          created_at?: string
          dataset?: string
          id?: string
          label?: string
          text?: string
        }
        Relationships: []
      }
      fixes: {
        Row: {
          after_html: string
          applied: boolean
          before_html: string
          confidence: number
          created_at: string
          id: string
          issue_id: string
          method: string
        }
        Insert: {
          after_html?: string
          applied?: boolean
          before_html?: string
          confidence?: number
          created_at?: string
          id?: string
          issue_id: string
          method?: string
        }
        Update: {
          after_html?: string
          applied?: boolean
          before_html?: string
          confidence?: number
          created_at?: string
          id?: string
          issue_id?: string
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixes_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          audit_id: string
          created_at: string
          id: string
          message: string
          ml_confidence: number | null
          ml_detail: Json | null
          rule_id: string
          selector: string
          severity_ml: string | null
          severity_rule: string
          snippet: string
          status: string
          wcag_criterion: string
          wcag_level: string
        }
        Insert: {
          audit_id: string
          created_at?: string
          id?: string
          message?: string
          ml_confidence?: number | null
          ml_detail?: Json | null
          rule_id: string
          selector: string
          severity_ml?: string | null
          severity_rule?: string
          snippet?: string
          status?: string
          wcag_criterion: string
          wcag_level?: string
        }
        Update: {
          audit_id?: string
          created_at?: string
          id?: string
          message?: string
          ml_confidence?: number | null
          ml_detail?: Json | null
          rule_id?: string
          selector?: string
          severity_ml?: string | null
          severity_rule?: string
          snippet?: string
          status?: string
          wcag_criterion?: string
          wcag_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_models: {
        Row: {
          id: string
          kind: string
          metrics: Json
          name: string
          trained_at: string
          version: string
        }
        Insert: {
          id?: string
          kind: string
          metrics?: Json
          name: string
          trained_at?: string
          version?: string
        }
        Update: {
          id?: string
          kind?: string
          metrics?: Json
          name?: string
          trained_at?: string
          version?: string
        }
        Relationships: []
      }
      prediction_logs: {
        Row: {
          audit_id: string | null
          created_at: string
          id: string
          input_text: string
          model_kind: string
          predicted_label: string
          probabilities: Json
        }
        Insert: {
          audit_id?: string | null
          created_at?: string
          id?: string
          input_text?: string
          model_kind: string
          predicted_label?: string
          probabilities?: Json
        }
        Update: {
          audit_id?: string | null
          created_at?: string
          id?: string
          input_text?: string
          model_kind?: string
          predicted_label?: string
          probabilities?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prediction_logs_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          source_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          source_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          source_type?: string
        }
        Relationships: []
      }
      remediated_pages: {
        Row: {
          audit_id: string
          created_at: string
          html_fixed: string
          id: string
          issues_after: number
          score_after: number
        }
        Insert: {
          audit_id: string
          created_at?: string
          html_fixed: string
          id?: string
          issues_after?: number
          score_after?: number
        }
        Update: {
          audit_id?: string
          created_at?: string
          html_fixed?: string
          id?: string
          issues_after?: number
          score_after?: number
        }
        Relationships: [
          {
            foreignKeyName: "remediated_pages_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      training_runs: {
        Row: {
          acc_history: Json
          created_at: string
          duration_ms: number
          epochs: number
          id: string
          loss_history: Json
          model_id: string
          train_size: number
          val_acc_history: Json
          val_loss_history: Json
          val_size: number
        }
        Insert: {
          acc_history?: Json
          created_at?: string
          duration_ms?: number
          epochs?: number
          id?: string
          loss_history?: Json
          model_id: string
          train_size?: number
          val_acc_history?: Json
          val_loss_history?: Json
          val_size?: number
        }
        Update: {
          acc_history?: Json
          created_at?: string
          duration_ms?: number
          epochs?: number
          id?: string
          loss_history?: Json
          model_id?: string
          train_size?: number
          val_acc_history?: Json
          val_loss_history?: Json
          val_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_runs_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ml_models"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
