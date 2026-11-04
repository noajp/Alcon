// Generated from the live database schema by Supabase (generate_typescript_types).
// Do not edit by hand: regenerate with `npm run gen:types` after a migration.
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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_space_members: {
        Row: {
          activity_space_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_space_members_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_spaces: {
        Row: {
          ai_monthly_budget_usd: number
          color: string | null
          created_at: string
          created_by: string
          id: string
          identifier: string | null
          logo: string | null
          name: string
          order_index: number
          scope: string
          updated_at: string
        }
        Insert: {
          ai_monthly_budget_usd?: number
          color?: string | null
          created_at?: string
          created_by?: string
          id?: string
          identifier?: string | null
          logo?: string | null
          name: string
          order_index?: number
          scope?: string
          updated_at?: string
        }
        Update: {
          ai_monthly_budget_usd?: number
          color?: string | null
          created_at?: string
          created_by?: string
          id?: string
          identifier?: string | null
          logo?: string | null
          name?: string
          order_index?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_actions: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          element_id: string
          id: string
          input: Json
          input_hash: string
          integration_id: string | null
          result: Json | null
          run_id: string
          status: string
          summary: string
          tool: string
          tool_use_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          element_id: string
          id?: string
          input?: Json
          input_hash: string
          integration_id?: string | null
          result?: Json | null
          run_id: string
          status?: string
          summary: string
          tool: string
          tool_use_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          element_id?: string
          id?: string
          input?: Json
          input_hash?: string
          integration_id?: string | null
          result?: Json | null
          run_id?: string
          status?: string
          summary?: string
          tool?: string
          tool_use_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_artifacts: {
        Row: {
          author_name: string | null
          content: string
          created_at: string
          created_by: string | null
          element_id: string
          format: string
          id: string
          run_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          element_id: string
          format?: string
          id?: string
          run_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          element_id?: string
          format?: string
          id?: string
          run_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_artifacts_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_run_steps: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          idx: number
          run_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          idx: number
          run_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          idx?: number
          run_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          activity_space_id: string | null
          continuation_count: number
          continuation_token: string | null
          cost_usd: number
          created_at: string
          domain_id: string | null
          element_id: string
          error: string | null
          finished_at: string | null
          id: string
          input_tokens: number
          mode: string
          model: string | null
          output_tokens: number
          prompt: string | null
          reply_to: string | null
          result: string | null
          started_at: string | null
          status: string
          step_count: number
          summary: string | null
          transcript: Json | null
          triggered_by: string | null
          triggered_from: string | null
          worker_id: string | null
        }
        Insert: {
          activity_space_id?: string | null
          continuation_count?: number
          continuation_token?: string | null
          cost_usd?: number
          created_at?: string
          domain_id?: string | null
          element_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number
          mode?: string
          model?: string | null
          output_tokens?: number
          prompt?: string | null
          reply_to?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          step_count?: number
          summary?: string | null
          transcript?: Json | null
          triggered_by?: string | null
          triggered_from?: string | null
          worker_id?: string | null
        }
        Update: {
          activity_space_id?: string | null
          continuation_count?: number
          continuation_token?: string | null
          cost_usd?: number
          created_at?: string
          domain_id?: string | null
          element_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number
          mode?: string
          model?: string | null
          output_tokens?: number
          prompt?: string | null
          reply_to?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          step_count?: number
          summary?: string | null
          transcript?: Json | null
          triggered_by?: string | null
          triggered_from?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_folders: {
        Row: {
          activity_space_id: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          id?: string
          name: string
          user_id?: string
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_sessions: {
        Row: {
          activity_space_id: string
          created_at: string
          folder_id: string | null
          id: string
          messages: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          folder_id?: string | null
          id?: string
          messages?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          folder_id?: string | null
          id?: string
          messages?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sessions_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "ai_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      approach_assessments: {
        Row: {
          approach_id: string
          author_id: string
          condition_id: string
          created_at: string
          evidence_source: string
          id: string
          observation: string
          observed_on: string
          plan_revision: number
          reasoning: string
          result: string
        }
        Insert: {
          approach_id: string
          author_id?: string
          condition_id: string
          created_at?: string
          evidence_source: string
          id?: string
          observation: string
          observed_on: string
          plan_revision: number
          reasoning: string
          result: string
        }
        Update: {
          approach_id?: string
          author_id?: string
          condition_id?: string
          created_at?: string
          evidence_source?: string
          id?: string
          observation?: string
          observed_on?: string
          plan_revision?: number
          reasoning?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "approach_assessments_approach_id_fkey"
            columns: ["approach_id"]
            isOneToOne: false
            referencedRelation: "domain_approaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approach_assessments_condition_id_approach_id_fkey"
            columns: ["condition_id", "approach_id"]
            isOneToOne: false
            referencedRelation: "approach_conditions"
            referencedColumns: ["id", "approach_id"]
          },
        ]
      }
      approach_conditions: {
        Row: {
          approach_id: string
          created_at: string
          id: string
          kind: string
          required: boolean
          review_date: string | null
          success_criteria: string
          title: string
        }
        Insert: {
          approach_id: string
          created_at?: string
          id?: string
          kind: string
          required?: boolean
          review_date?: string | null
          success_criteria: string
          title: string
        }
        Update: {
          approach_id?: string
          created_at?: string
          id?: string
          kind?: string
          required?: boolean
          review_date?: string | null
          success_criteria?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "approach_conditions_approach_id_fkey"
            columns: ["approach_id"]
            isOneToOne: false
            referencedRelation: "domain_approaches"
            referencedColumns: ["id"]
          },
        ]
      }
      approach_contributions: {
        Row: {
          approach_id: string
          condition_id: string
          id: string
          object_id: string
          rationale: string
          role: string
          sequence_note: string
        }
        Insert: {
          approach_id: string
          condition_id: string
          id?: string
          object_id: string
          rationale: string
          role: string
          sequence_note?: string
        }
        Update: {
          approach_id?: string
          condition_id?: string
          id?: string
          object_id?: string
          rationale?: string
          role?: string
          sequence_note?: string
        }
        Relationships: [
          {
            foreignKeyName: "approach_contributions_approach_id_fkey"
            columns: ["approach_id"]
            isOneToOne: false
            referencedRelation: "domain_approaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approach_contributions_condition_id_approach_id_fkey"
            columns: ["condition_id", "approach_id"]
            isOneToOne: false
            referencedRelation: "approach_conditions"
            referencedColumns: ["id", "approach_id"]
          },
          {
            foreignKeyName: "approach_contributions_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      approach_reviews: {
        Row: {
          action: string
          approach_id: string
          author_id: string
          changes: string
          created_at: string
          expected_revision: number
          id: string
          next_review_date: string | null
          reasoning: string
          snapshot: Json
        }
        Insert: {
          action: string
          approach_id: string
          author_id?: string
          changes?: string
          created_at?: string
          expected_revision: number
          id?: string
          next_review_date?: string | null
          reasoning: string
          snapshot?: Json
        }
        Update: {
          action?: string
          approach_id?: string
          author_id?: string
          changes?: string
          created_at?: string
          expected_revision?: number
          id?: string
          next_review_date?: string | null
          reasoning?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "approach_reviews_approach_id_fkey"
            columns: ["approach_id"]
            isOneToOne: false
            referencedRelation: "domain_approaches"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_calls: {
        Row: {
          asset_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          result: Json | null
          run_id: string | null
          status: string
          tool: string
        }
        Insert: {
          asset_id: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          result?: Json | null
          run_id?: string | null
          status?: string
          tool: string
        }
        Update: {
          asset_id?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          result?: Json | null
          run_id?: string | null
          status?: string
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_calls_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_events: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          kind: string
          occurred_at: string
          payload: Json | null
          summary: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          kind: string
          occurred_at?: string
          payload?: Json | null
          summary: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          kind?: string
          occurred_at?: string
          payload?: Json | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          activity_space_id: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          event_count: number
          id: string
          kind: string
          last_seen_at: string | null
          manifest: Json
          name: string
          observed: Json
          revoked_at: string | null
          status: string
          token_hash: string
          token_prefix: string
          updated_at: string
        }
        Insert: {
          activity_space_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          event_count?: number
          id?: string
          kind?: string
          last_seen_at?: string | null
          manifest?: Json
          name: string
          observed?: Json
          revoked_at?: string | null
          status?: string
          token_hash: string
          token_prefix: string
          updated_at?: string
        }
        Update: {
          activity_space_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          event_count?: number
          id?: string
          kind?: string
          last_seen_at?: string | null
          manifest?: Json
          name?: string
          observed?: Json
          revoked_at?: string | null
          status?: string
          token_hash?: string
          token_prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_texts: {
        Row: {
          attachment_id: string
          body: string
          extracted_at: string
        }
        Insert: {
          attachment_id: string
          body: string
          extracted_at?: string
        }
        Update: {
          attachment_id?: string
          body?: string
          extracted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_texts_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          element_id: string | null
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          object_id: string | null
          path: string
          previous_id: string | null
          size: number
          strategy_id: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          element_id?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          object_id?: string | null
          path: string
          previous_id?: string | null
          size?: number
          strategy_id?: string | null
          uploaded_by?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          element_id?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          object_id?: string | null
          path?: string
          previous_id?: string | null
          size?: number
          strategy_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_files_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_files_previous_id_fkey"
            columns: ["previous_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      board_placements: {
        Row: {
          board_id: string
          default_id: string | null
          id: string
          position: number
          size: string | null
          updated_at: string
          updated_by: string | null
          widget_id: string
          zone: string
        }
        Insert: {
          board_id: string
          default_id?: string | null
          id?: string
          position: number
          size?: string | null
          updated_at?: string
          updated_by?: string | null
          widget_id: string
          zone: string
        }
        Update: {
          board_id?: string
          default_id?: string | null
          id?: string
          position?: number
          size?: string | null
          updated_at?: string
          updated_by?: string | null
          widget_id?: string
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_placements_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_placements_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          dismissed_defaults: string[]
          id: string
          revision: number
          space_id: string | null
          subject_id: string
          subject_kind: string
          surface: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          dismissed_defaults?: string[]
          id?: string
          revision?: number
          space_id?: string | null
          subject_id: string
          subject_kind: string
          surface: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          dismissed_defaults?: string[]
          id?: string
          revision?: number
          space_id?: string | null
          subject_id?: string
          subject_kind?: string
          surface?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      code_change_comments: {
        Row: {
          author_id: string
          author_name: string | null
          body: string
          code_change_id: string
          created_at: string
          github_comment_id: number | null
          github_error: string | null
          head_sha: string | null
          id: string
          line: number
          path: string
          resolved: boolean
          side: string
        }
        Insert: {
          author_id?: string
          author_name?: string | null
          body: string
          code_change_id: string
          created_at?: string
          github_comment_id?: number | null
          github_error?: string | null
          head_sha?: string | null
          id?: string
          line: number
          path: string
          resolved?: boolean
          side: string
        }
        Update: {
          author_id?: string
          author_name?: string | null
          body?: string
          code_change_id?: string
          created_at?: string
          github_comment_id?: number | null
          github_error?: string | null
          head_sha?: string | null
          id?: string
          line?: number
          path?: string
          resolved?: boolean
          side?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_change_comments_code_change_id_fkey"
            columns: ["code_change_id"]
            isOneToOne: false
            referencedRelation: "code_changes"
            referencedColumns: ["id"]
          },
        ]
      }
      code_change_reviews: {
        Row: {
          body: string
          code_change_id: string
          created_at: string
          github_error: string | null
          github_review_id: number | null
          head_sha: string | null
          id: string
          reviewer_id: string
          reviewer_name: string | null
          verdict: string
        }
        Insert: {
          body?: string
          code_change_id: string
          created_at?: string
          github_error?: string | null
          github_review_id?: number | null
          head_sha?: string | null
          id?: string
          reviewer_id?: string
          reviewer_name?: string | null
          verdict: string
        }
        Update: {
          body?: string
          code_change_id?: string
          created_at?: string
          github_error?: string | null
          github_review_id?: number | null
          head_sha?: string | null
          id?: string
          reviewer_id?: string
          reviewer_name?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_change_reviews_code_change_id_fkey"
            columns: ["code_change_id"]
            isOneToOne: false
            referencedRelation: "code_changes"
            referencedColumns: ["id"]
          },
        ]
      }
      code_changes: {
        Row: {
          activity_space_id: string | null
          additions: number | null
          author_login: string | null
          base_ref: string | null
          body: string | null
          changed_files: number | null
          created_at: string
          deletions: number | null
          element_id: string
          guide: Json | null
          head_ref: string | null
          head_sha: string | null
          id: string
          intent_check: Json | null
          linked_by: string | null
          linked_via: string
          number: number
          provider: string
          repo: string
          run_id: string | null
          state: string
          synced_at: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          activity_space_id?: string | null
          additions?: number | null
          author_login?: string | null
          base_ref?: string | null
          body?: string | null
          changed_files?: number | null
          created_at?: string
          deletions?: number | null
          element_id: string
          guide?: Json | null
          head_ref?: string | null
          head_sha?: string | null
          id?: string
          intent_check?: Json | null
          linked_by?: string | null
          linked_via?: string
          number: number
          provider?: string
          repo: string
          run_id?: string | null
          state?: string
          synced_at?: string | null
          title?: string
          updated_at?: string
          url: string
        }
        Update: {
          activity_space_id?: string | null
          additions?: number | null
          author_login?: string | null
          base_ref?: string | null
          body?: string | null
          changed_files?: number | null
          created_at?: string
          deletions?: number | null
          element_id?: string
          guide?: Json | null
          head_ref?: string | null
          head_sha?: string | null
          id?: string
          intent_check?: Json | null
          linked_by?: string | null
          linked_via?: string
          number?: number
          provider?: string
          repo?: string
          run_id?: string | null
          state?: string
          synced_at?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_changes_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_column_placements: {
        Row: {
          column_id: string
          created_at: string | null
          id: string
          object_id: string | null
          order_index: number | null
          owner_user_id: string | null
        }
        Insert: {
          column_id: string
          created_at?: string | null
          id?: string
          object_id?: string | null
          order_index?: number | null
          owner_user_id?: string | null
        }
        Update: {
          column_id?: string
          created_at?: string | null
          id?: string
          object_id?: string | null
          order_index?: number | null
          owner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_column_placements_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "custom_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_column_placements_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_column_values: {
        Row: {
          column_id: string
          created_at: string | null
          element_id: string | null
          id: string
          object_id: string | null
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          column_id: string
          created_at?: string | null
          element_id?: string | null
          id?: string
          object_id?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          column_id?: string
          created_at?: string | null
          element_id?: string | null
          id?: string
          object_id?: string | null
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_column_values_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "custom_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_column_values_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_column_values_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_columns: {
        Row: {
          activity_space_id: string | null
          column_type: string
          created_at: string | null
          domain_id: string | null
          id: string
          is_visible: boolean | null
          name: string
          object_id: string | null
          options: Json | null
          order_index: number | null
          owner_user_id: string | null
          updated_at: string | null
          width: number | null
        }
        Insert: {
          activity_space_id?: string | null
          column_type: string
          created_at?: string | null
          domain_id?: string | null
          id?: string
          is_visible?: boolean | null
          name: string
          object_id?: string | null
          options?: Json | null
          order_index?: number | null
          owner_user_id?: string | null
          updated_at?: string | null
          width?: number | null
        }
        Update: {
          activity_space_id?: string | null
          column_type?: string
          created_at?: string | null
          domain_id?: string | null
          id?: string
          is_visible?: boolean | null
          name?: string
          object_id?: string | null
          options?: Json | null
          order_index?: number | null
          owner_user_id?: string | null
          updated_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_columns_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_columns_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_columns_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_folders: {
        Row: {
          activity_space_id: string
          created_by: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          activity_space_id: string
          created_by?: string | null
          id: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          activity_space_id?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_folders_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          activity_space_id: string
          chat: Json
          created_by: string | null
          deck: Json
          folder_id: string | null
          id: string
          mix: Json
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_space_id: string
          chat?: Json
          created_by?: string | null
          deck: Json
          folder_id?: string | null
          id: string
          mix?: Json
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_space_id?: string
          chat?: Json
          created_by?: string | null
          deck?: Json
          folder_id?: string | null
          id?: string
          mix?: Json
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decks_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decks_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "deck_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      definitions: {
        Row: {
          activity_space_id: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          activity_space_id: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          activity_space_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "definitions_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_grant_versions: {
        Row: {
          activity_space_id: string
          changed_by: string | null
          created_at: string
          deployment_id: string
          grants: Json
          version: number
        }
        Insert: {
          activity_space_id: string
          changed_by?: string | null
          created_at?: string
          deployment_id: string
          grants: Json
          version: number
        }
        Update: {
          activity_space_id?: string
          changed_by?: string | null
          created_at?: string
          deployment_id?: string
          grants?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deployment_grant_versions_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "workflow_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_grants: {
        Row: {
          activity_space_id: string
          connector: string
          created_at: string
          created_by: string | null
          deployment_id: string
          operation: string
        }
        Insert: {
          activity_space_id: string
          connector: string
          created_at?: string
          created_by?: string | null
          deployment_id: string
          operation: string
        }
        Update: {
          activity_space_id?: string
          connector?: string
          created_at?: string
          created_by?: string | null
          deployment_id?: string
          operation?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_grants_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "workflow_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_control: {
        Row: {
          id: number
          max_concurrent: number
          note: string | null
          paused: boolean
          updated_at: string
        }
        Insert: {
          id?: number
          max_concurrent?: number
          note?: string | null
          paused?: boolean
          updated_at?: string
        }
        Update: {
          id?: number
          max_concurrent?: number
          note?: string | null
          paused?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      dev_events: {
        Row: {
          consumed_at: string | null
          created_at: string
          id: string
          kind: string
          payload: Json | null
          ref: string | null
          source: string
          title: string
          url: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json | null
          ref?: string | null
          source: string
          title: string
          url?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          ref?: string | null
          source?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      domain_approaches: {
        Row: {
          assumptions: string
          created_at: string
          created_by: string
          domain_id: string
          expected_change: string
          hypothesis: string
          id: string
          measure_id: string | null
          plan_revision: number
          review_date: string | null
          review_trigger: string
          revision: number
          strategy_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assumptions?: string
          created_at?: string
          created_by?: string
          domain_id: string
          expected_change: string
          hypothesis: string
          id?: string
          measure_id?: string | null
          plan_revision?: number
          review_date?: string | null
          review_trigger?: string
          revision?: number
          strategy_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assumptions?: string
          created_at?: string
          created_by?: string
          domain_id?: string
          expected_change?: string
          hypothesis?: string
          id?: string
          measure_id?: string | null
          plan_revision?: number
          review_date?: string | null
          review_trigger?: string
          revision?: number
          strategy_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_approaches_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_approaches_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_approaches_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_members: {
        Row: {
          created_at: string
          domain_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_members_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          activity_space_id: string | null
          ai_config: Json | null
          color: string | null
          created_at: string
          description: string | null
          element_types: Json
          icon: string | null
          id: string
          identifier: string | null
          label_colors: Json
          name: string
          object_types: string[]
          order_index: number | null
          phase_defaults: Json
          privacy: string | null
          risk_thresholds: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activity_space_id?: string | null
          ai_config?: Json | null
          color?: string | null
          created_at?: string
          description?: string | null
          element_types?: Json
          icon?: string | null
          id?: string
          identifier?: string | null
          label_colors?: Json
          name: string
          object_types?: string[]
          order_index?: number | null
          phase_defaults?: Json
          privacy?: string | null
          risk_thresholds?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activity_space_id?: string | null
          ai_config?: Json | null
          color?: string | null
          created_at?: string
          description?: string | null
          element_types?: Json
          icon?: string | null
          id?: string
          identifier?: string | null
          label_colors?: Json
          name?: string
          object_types?: string[]
          order_index?: number | null
          phase_defaults?: Json
          privacy?: string | null
          risk_thresholds?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "domains_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      element_activity: {
        Row: {
          actor_id: string | null
          author: string
          created_at: string
          detail: string
          element_id: string
          id: string
          kind: string
        }
        Insert: {
          actor_id?: string | null
          author?: string
          created_at?: string
          detail: string
          element_id: string
          id?: string
          kind: string
        }
        Update: {
          actor_id?: string | null
          author?: string
          created_at?: string
          detail?: string
          element_id?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_activity_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      element_approvals: {
        Row: {
          approver_id: string | null
          approver_name: string | null
          decided_at: string
          element_id: string
          id: string
          note: string | null
          state: string
        }
        Insert: {
          approver_id?: string | null
          approver_name?: string | null
          decided_at?: string
          element_id: string
          id?: string
          note?: string | null
          state: string
        }
        Update: {
          approver_id?: string | null
          approver_name?: string | null
          decided_at?: string
          element_id?: string
          id?: string
          note?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_approvals_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      element_assignees: {
        Row: {
          assigned_at: string | null
          element_id: string
          id: string
          role: string | null
          worker_id: string
        }
        Insert: {
          assigned_at?: string | null
          element_id: string
          id?: string
          role?: string | null
          worker_id: string
        }
        Update: {
          assigned_at?: string | null
          element_id?: string
          id?: string
          role?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_assignees_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_assignees_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      element_check_ins: {
        Row: {
          author_id: string
          comment_content: string
          comment_id: string
          created_at: string
          element_id: string
          expected_updated_at: string | null
          note: string
          patch: Json
          request_id: string
          result_updated_at: string
          transaction_id: unknown
        }
        Insert: {
          author_id: string
          comment_content: string
          comment_id: string
          created_at?: string
          element_id: string
          expected_updated_at?: string | null
          note: string
          patch: Json
          request_id: string
          result_updated_at: string
          transaction_id?: unknown
        }
        Update: {
          author_id?: string
          comment_content?: string
          comment_id?: string
          created_at?: string
          element_id?: string
          expected_updated_at?: string | null
          note?: string
          patch?: Json
          request_id?: string
          result_updated_at?: string
          transaction_id?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "element_check_ins_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      element_comments: {
        Row: {
          author_id: string | null
          author_kind: string
          author_name: string | null
          content: string
          created_at: string
          element_id: string
          holder: string | null
          id: string
          is_pinned: boolean
          mentions: string[]
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_kind?: string
          author_name?: string | null
          content: string
          created_at?: string
          element_id: string
          holder?: string | null
          id?: string
          is_pinned?: boolean
          mentions?: string[]
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_kind?: string
          author_name?: string | null
          content?: string
          created_at?: string
          element_id?: string
          holder?: string | null
          id?: string
          is_pinned?: boolean
          mentions?: string[]
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_comments_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "element_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      element_deletions: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          display_id: string | null
          element_id: string
          id: string
          object_id: string | null
          owner_id: string | null
          snapshot: Json
          title: string
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          display_id?: string | null
          element_id: string
          id?: string
          object_id?: string | null
          owner_id?: string | null
          snapshot: Json
          title: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          display_id?: string | null
          element_id?: string
          id?: string
          object_id?: string | null
          owner_id?: string | null
          snapshot?: Json
          title?: string
        }
        Relationships: []
      }
      element_edges: {
        Row: {
          attributes: Json | null
          created_at: string | null
          created_by: string | null
          edge_type: string
          from_element: string
          id: string
          to_element: string
        }
        Insert: {
          attributes?: Json | null
          created_at?: string | null
          created_by?: string | null
          edge_type: string
          from_element: string
          id?: string
          to_element: string
        }
        Update: {
          attributes?: Json | null
          created_at?: string | null
          created_by?: string | null
          edge_type?: string
          from_element?: string
          id?: string
          to_element?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_edges_from_element_fkey"
            columns: ["from_element"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_edges_to_element_fkey"
            columns: ["to_element"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      element_objects: {
        Row: {
          created_at: string | null
          element_id: string
          id: string
          is_primary: boolean | null
          object_id: string
          order_index: number | null
        }
        Insert: {
          created_at?: string | null
          element_id: string
          id?: string
          is_primary?: boolean | null
          object_id: string
          order_index?: number | null
        }
        Update: {
          created_at?: string | null
          element_id?: string
          id?: string
          is_primary?: boolean | null
          object_id?: string
          order_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "element_objects_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_objects_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      element_reactions: {
        Row: {
          comment_id: string | null
          created_at: string
          element_id: string | null
          emoji: string
          id: string
          user_id: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          element_id?: string | null
          emoji: string
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          element_id?: string | null
          emoji?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "element_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "element_reactions_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
        ]
      }
      element_templates: {
        Row: {
          assignee_worker_ids: Json
          created_at: string
          description: string | null
          domain_id: string
          estimated_hours: number | null
          id: string
          labels: Json
          name: string
          order_index: number
          priority: string | null
          status: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          assignee_worker_ids?: Json
          created_at?: string
          description?: string | null
          domain_id: string
          estimated_hours?: number | null
          id?: string
          labels?: Json
          name: string
          order_index?: number
          priority?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          assignee_worker_ids?: Json
          created_at?: string
          description?: string | null
          domain_id?: string
          estimated_hours?: number | null
          id?: string
          labels?: Json
          name?: string
          order_index?: number
          priority?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "element_templates_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      elements: {
        Row: {
          actual_hours: number | null
          ai_weight: string | null
          approval_state: string | null
          branch: string | null
          carried_over_count: number
          claim_expires_at: string | null
          claimed_by: string | null
          color: string | null
          created_at: string | null
          definition_id: string | null
          description: string | null
          direction: Json | null
          display_id: string | null
          due_date: string | null
          due_time: string | null
          estimated_hours: number | null
          id: string
          is_approval: boolean
          labels: Json
          note_id: string | null
          object_id: string | null
          order_index: number | null
          owner_id: string | null
          parent_id: string | null
          phase_id: string | null
          priority: string | null
          progress: number | null
          seq_number: number | null
          start_date: string | null
          start_time: string | null
          status: string | null
          title: string
          type: string | null
          updated_at: string | null
        }
        Insert: {
          actual_hours?: number | null
          ai_weight?: string | null
          approval_state?: string | null
          branch?: string | null
          carried_over_count?: number
          claim_expires_at?: string | null
          claimed_by?: string | null
          color?: string | null
          created_at?: string | null
          definition_id?: string | null
          description?: string | null
          direction?: Json | null
          display_id?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_hours?: number | null
          id?: string
          is_approval?: boolean
          labels?: Json
          note_id?: string | null
          object_id?: string | null
          order_index?: number | null
          owner_id?: string | null
          parent_id?: string | null
          phase_id?: string | null
          priority?: string | null
          progress?: number | null
          seq_number?: number | null
          start_date?: string | null
          start_time?: string | null
          status?: string | null
          title: string
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_hours?: number | null
          ai_weight?: string | null
          approval_state?: string | null
          branch?: string | null
          carried_over_count?: number
          claim_expires_at?: string | null
          claimed_by?: string | null
          color?: string | null
          created_at?: string | null
          definition_id?: string | null
          description?: string | null
          direction?: Json | null
          display_id?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_hours?: number | null
          id?: string
          is_approval?: boolean
          labels?: Json
          note_id?: string | null
          object_id?: string | null
          order_index?: number | null
          owner_id?: string | null
          parent_id?: string | null
          phase_id?: string | null
          priority?: string | null
          progress?: number | null
          seq_number?: number | null
          start_date?: string | null
          start_time?: string | null
          status?: string | null
          title?: string
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "elements_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elements_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elements_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elements_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elements_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          activity_space_id: string
          app: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          domain_id: string | null
          id: string
          name: string
          position: number
        }
        Insert: {
          activity_space_id: string
          app?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          domain_id?: string | null
          id?: string
          name: string
          position?: number
        }
        Update: {
          activity_space_id?: string
          app?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          domain_id?: string | null
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "folders_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      home_pins: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          position?: number
          user_id?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          position?: number
          user_id?: string
        }
        Relationships: []
      }
      integration_oauth_states: {
        Row: {
          browser_nonce_hash: string | null
          code_verifier: string
          completion_expires_at: string | null
          completion_hash: string | null
          created_at: string
          expires_at: string
          id: string
          integration_id: string
          pending_account: string | null
          state_hash: string | null
          ticket_expires_at: string
          ticket_hash: string | null
          user_id: string
        }
        Insert: {
          browser_nonce_hash?: string | null
          code_verifier: string
          completion_expires_at?: string | null
          completion_hash?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          integration_id: string
          pending_account?: string | null
          state_hash?: string | null
          ticket_expires_at?: string
          ticket_hash?: string | null
          user_id: string
        }
        Update: {
          browser_nonce_hash?: string | null
          code_verifier?: string
          completion_expires_at?: string | null
          completion_hash?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          integration_id?: string
          pending_account?: string | null
          state_hash?: string | null
          ticket_expires_at?: string
          ticket_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_oauth_states_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          activity_space_id: string
          auth_header: string | null
          auth_type: string
          created_at: string
          created_by: string | null
          delegation: string
          description: string | null
          enabled: boolean
          endpoint: string
          external_account: string | null
          guide: string | null
          icon: string | null
          id: string
          kind: string
          last_test: Json | null
          manifest: Json | null
          name: string
          preset: string | null
          secret_id: string | null
          updated_at: string
        }
        Insert: {
          activity_space_id: string
          auth_header?: string | null
          auth_type?: string
          created_at?: string
          created_by?: string | null
          delegation?: string
          description?: string | null
          enabled?: boolean
          endpoint: string
          external_account?: string | null
          guide?: string | null
          icon?: string | null
          id?: string
          kind: string
          last_test?: Json | null
          manifest?: Json | null
          name: string
          preset?: string | null
          secret_id?: string | null
          updated_at?: string
        }
        Update: {
          activity_space_id?: string
          auth_header?: string | null
          auth_type?: string
          created_at?: string
          created_by?: string | null
          delegation?: string
          description?: string | null
          enabled?: boolean
          endpoint?: string
          external_account?: string | null
          guide?: string | null
          icon?: string | null
          id?: string
          kind?: string
          last_test?: Json | null
          manifest?: Json | null
          name?: string
          preset?: string | null
          secret_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_alignments: {
        Row: {
          body: string | null
          detected_at: string
          id: string
          intent_id: string
          involves_intent_ids: string[]
          kind: string
          metadata: Json | null
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          body?: string | null
          detected_at?: string
          id?: string
          intent_id: string
          involves_intent_ids?: string[]
          kind: string
          metadata?: Json | null
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          body?: string | null
          detected_at?: string
          id?: string
          intent_id?: string
          involves_intent_ids?: string[]
          kind?: string
          metadata?: Json | null
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_alignments_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_audits: {
        Row: {
          authentic_count: number
          delta_30d: number | null
          id: string
          indeterminate_count: number
          intent_id: string
          llm_note: string | null
          ran_at: string
          score: number
          suspected_count: number
          total_elements: number
        }
        Insert: {
          authentic_count?: number
          delta_30d?: number | null
          id?: string
          indeterminate_count?: number
          intent_id: string
          llm_note?: string | null
          ran_at?: string
          score: number
          suspected_count?: number
          total_elements?: number
        }
        Update: {
          authentic_count?: number
          delta_30d?: number | null
          id?: string
          indeterminate_count?: number
          intent_id?: string
          llm_note?: string | null
          ran_at?: string
          score?: number
          suspected_count?: number
          total_elements?: number
        }
        Relationships: [
          {
            foreignKeyName: "intent_audits_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_bindings: {
        Row: {
          created_at: string
          id: string
          intent_id: string
          note: string | null
          relationship_type: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          intent_id: string
          note?: string | null
          relationship_type: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          intent_id?: string
          note?: string | null
          relationship_type?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_bindings_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_escalations: {
        Row: {
          collected_context: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          decision_owner_name: string | null
          decision_owner_role: string | null
          flagged_assumptions: string[]
          id: string
          intent_id: string
          status: string
          trigger_kind: string
          trigger_summary: string
          triggered_at: string
        }
        Insert: {
          collected_context?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          decision_owner_name?: string | null
          decision_owner_role?: string | null
          flagged_assumptions?: string[]
          id?: string
          intent_id: string
          status?: string
          trigger_kind: string
          trigger_summary: string
          triggered_at?: string
        }
        Update: {
          collected_context?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          decision_owner_name?: string | null
          decision_owner_role?: string | null
          flagged_assumptions?: string[]
          id?: string
          intent_id?: string
          status?: string
          trigger_kind?: string
          trigger_summary?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_escalations_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_lineage: {
        Row: {
          action_kind: string
          actor_name: string
          actor_role: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          intent_id: string
          occurred_at: string
        }
        Insert: {
          action_kind: string
          actor_name: string
          actor_role?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          intent_id: string
          occurred_at: string
        }
        Update: {
          action_kind?: string
          actor_name?: string
          actor_role?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          intent_id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_lineage_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_measure_readings: {
        Row: {
          direction: string | null
          id: string
          intent_id: string
          measured_at: string | null
          previous_value: number | null
          recorded_at: string
          recorded_by: string | null
          recorded_by_name: string | null
          source: string
          target_value: number | null
          unit: string | null
          value: number | null
        }
        Insert: {
          direction?: string | null
          id?: string
          intent_id: string
          measured_at?: string | null
          previous_value?: number | null
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          source?: string
          target_value?: number | null
          unit?: string | null
          value?: number | null
        }
        Update: {
          direction?: string | null
          id?: string
          intent_id?: string
          measured_at?: string | null
          previous_value?: number | null
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          source?: string
          target_value?: number | null
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intent_measure_readings_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_next_actions: {
        Row: {
          converted_element_id: string | null
          generated_at: string
          hypothesis: string | null
          id: string
          intent_id: string
          label: string
          order_index: number
          status: string
          title: string
        }
        Insert: {
          converted_element_id?: string | null
          generated_at?: string
          hypothesis?: string | null
          id?: string
          intent_id: string
          label: string
          order_index?: number
          status?: string
          title: string
        }
        Update: {
          converted_element_id?: string | null
          generated_at?: string
          hypothesis?: string | null
          id?: string
          intent_id?: string
          label?: string
          order_index?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_next_actions_converted_element_id_fkey"
            columns: ["converted_element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_next_actions_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_predictions: {
        Row: {
          archived_at: string | null
          id: string
          intent_id: string
          official_report: number | null
          probability: number
          role_group: string | null
          voted_at: string
          voter_hash: string
        }
        Insert: {
          archived_at?: string | null
          id?: string
          intent_id: string
          official_report?: number | null
          probability: number
          role_group?: string | null
          voted_at?: string
          voter_hash: string
        }
        Update: {
          archived_at?: string | null
          id?: string
          intent_id?: string
          official_report?: number | null
          probability?: number
          role_group?: string | null
          voted_at?: string
          voter_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_predictions_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_resources: {
        Row: {
          actual_share: number | null
          allocated_headcount: number | null
          breakdown: Json | null
          captured_at: string
          declared_share: number | null
          id: string
          intent_id: string
          note: string | null
          total_headcount: number | null
        }
        Insert: {
          actual_share?: number | null
          allocated_headcount?: number | null
          breakdown?: Json | null
          captured_at?: string
          declared_share?: number | null
          id?: string
          intent_id: string
          note?: string | null
          total_headcount?: number | null
        }
        Update: {
          actual_share?: number | null
          allocated_headcount?: number | null
          breakdown?: Json | null
          captured_at?: string
          declared_share?: number | null
          id?: string
          intent_id?: string
          note?: string | null
          total_headcount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intent_resources_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      intents: {
        Row: {
          abandoned: string | null
          actual_value: number | null
          captured_dimensions: string[]
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by_name: string | null
          decided_by_role: string | null
          direction: string | null
          horizon: string | null
          id: string
          kind: string
          measured_at: string | null
          order_index: number
          parent_intent_id: string | null
          slug: string | null
          status: string
          strategy_id: string
          subtitle: string | null
          superseded_by_intent_id: string | null
          target_value: number | null
          title: string
          uncaptured_dimensions: string[]
          unit: string | null
          updated_at: string
        }
        Insert: {
          abandoned?: string | null
          actual_value?: number | null
          captured_dimensions?: string[]
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by_name?: string | null
          decided_by_role?: string | null
          direction?: string | null
          horizon?: string | null
          id?: string
          kind?: string
          measured_at?: string | null
          order_index?: number
          parent_intent_id?: string | null
          slug?: string | null
          status?: string
          strategy_id: string
          subtitle?: string | null
          superseded_by_intent_id?: string | null
          target_value?: number | null
          title: string
          uncaptured_dimensions?: string[]
          unit?: string | null
          updated_at?: string
        }
        Update: {
          abandoned?: string | null
          actual_value?: number | null
          captured_dimensions?: string[]
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by_name?: string | null
          decided_by_role?: string | null
          direction?: string | null
          horizon?: string | null
          id?: string
          kind?: string
          measured_at?: string | null
          order_index?: number
          parent_intent_id?: string | null
          slug?: string | null
          status?: string
          strategy_id?: string
          subtitle?: string | null
          superseded_by_intent_id?: string | null
          target_value?: number | null
          title?: string
          uncaptured_dimensions?: string[]
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intents_parent_intent_id_fkey"
            columns: ["parent_intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intents_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intents_superseded_by_intent_id_fkey"
            columns: ["superseded_by_intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_invitations: {
        Row: {
          activity_space_id: string | null
          created_at: string
          domain_id: string | null
          id: string
          invited_by: string | null
          invitee_id: string
          inviter_name: string | null
          object_id: string | null
          responded_at: string | null
          role: string
          scope_name: string
          status: string
        }
        Insert: {
          activity_space_id?: string | null
          created_at?: string
          domain_id?: string | null
          id?: string
          invited_by?: string | null
          invitee_id: string
          inviter_name?: string | null
          object_id?: string | null
          responded_at?: string | null
          role?: string
          scope_name: string
          status?: string
        }
        Update: {
          activity_space_id?: string | null
          created_at?: string
          domain_id?: string | null
          id?: string
          invited_by?: string | null
          invitee_id?: string
          inviter_name?: string | null
          object_id?: string | null
          responded_at?: string | null
          role?: string
          scope_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_invitations_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_invitations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_invitations_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      note_contents: {
        Row: {
          html: string | null
          note_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          html?: string | null
          note_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          html?: string | null
          note_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "note_contents_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          created_at: string
          created_by: string
          icon: string | null
          id: string
          linked_object_id: string | null
          name: string
          order_index: number | null
          parent_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          icon?: string | null
          id?: string
          linked_object_id?: string | null
          name?: string
          order_index?: number | null
          parent_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          icon?: string | null
          id?: string
          linked_object_id?: string | null
          name?: string
          order_index?: number | null
          parent_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_linked_object_id_fkey"
            columns: ["linked_object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          body: string | null
          comment_id: string | null
          created_at: string
          element_id: string | null
          id: string
          intent_id: string | null
          invitation_id: string | null
          is_archived: boolean
          is_read: boolean
          kind: string
          object_id: string | null
          recipient_id: string
          strategy_comment_id: string | null
          strategy_id: string | null
          title: string
          workflow_approval_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          body?: string | null
          comment_id?: string | null
          created_at?: string
          element_id?: string | null
          id?: string
          intent_id?: string | null
          invitation_id?: string | null
          is_archived?: boolean
          is_read?: boolean
          kind: string
          object_id?: string | null
          recipient_id: string
          strategy_comment_id?: string | null
          strategy_id?: string | null
          title: string
          workflow_approval_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          body?: string | null
          comment_id?: string | null
          created_at?: string
          element_id?: string | null
          id?: string
          intent_id?: string | null
          invitation_id?: string | null
          is_archived?: boolean
          is_read?: boolean
          kind?: string
          object_id?: string | null
          recipient_id?: string
          strategy_comment_id?: string | null
          strategy_id?: string | null
          title?: string
          workflow_approval_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "element_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "membership_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_strategy_comment_id_fkey"
            columns: ["strategy_comment_id"]
            isOneToOne: false
            referencedRelation: "strategy_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workflow_approval_id_fkey"
            columns: ["workflow_approval_id"]
            isOneToOne: false
            referencedRelation: "workflow_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_client_access: {
        Row: {
          access: string
          client_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access?: string
          client_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          access?: string
          client_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      object_domains: {
        Row: {
          domain_id: string
          is_primary: boolean
          object_id: string
          order_index: number | null
        }
        Insert: {
          domain_id: string
          is_primary?: boolean
          object_id: string
          order_index?: number | null
        }
        Update: {
          domain_id?: string
          is_primary?: boolean
          object_id?: string
          order_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "object_domains_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_domains_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      object_members: {
        Row: {
          created_at: string
          id: string
          object_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          object_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          object_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "object_members_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      object_milestones: {
        Row: {
          created_at: string
          date: string
          id: string
          label: string | null
          object_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          label?: string | null
          object_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          label?: string | null
          object_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "object_milestones_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      object_tabs: {
        Row: {
          content: Json | null
          created_at: string | null
          id: string
          is_pinned: boolean | null
          note_id: string | null
          object_id: string
          order_index: number
          tab_type: string
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: Json | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          note_id?: string | null
          object_id: string
          order_index?: number
          tab_type: string
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: Json | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          note_id?: string | null
          object_id?: string
          order_index?: number
          tab_type?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "object_tabs_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_tabs_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      objects: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          color: string | null
          created_at: string | null
          description: string | null
          display_id: string | null
          domain_id: string | null
          due_date: string | null
          id: string
          lead_id: string | null
          name: string
          note_id: string | null
          order_index: number | null
          phase_id: string | null
          prefix: string | null
          start_date: string | null
          system_id: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          display_id?: string | null
          domain_id?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          name: string
          note_id?: string | null
          order_index?: number | null
          phase_id?: string | null
          prefix?: string | null
          start_date?: string | null
          system_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          display_id?: string | null
          domain_id?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          note_id?: string | null
          order_index?: number | null
          phase_id?: string | null
          prefix?: string | null
          start_date?: string | null
          system_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objects_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objects_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      org_unit_members: {
        Row: {
          created_at: string
          unit_id: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          unit_id: string
          worker_id: string
        }
        Update: {
          created_at?: string
          unit_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_unit_members_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_unit_members_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      org_units: {
        Row: {
          activity_space_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_worker_id: string | null
          name: string
          parent_id: string | null
          position: number
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_worker_id?: string | null
          name: string
          parent_id?: string | null
          position?: number
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_worker_id?: string | null
          name?: string
          parent_id?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_units_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_units_lead_worker_id_fkey"
            columns: ["lead_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_units_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_units"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_access_tokens: {
        Row: {
          access: string
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          last_used_client: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          access?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          last_used_client?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          user_id?: string
        }
        Update: {
          access?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          last_used_client?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: []
      }
      phases: {
        Row: {
          closed_at: string | null
          closing_note: string | null
          created_at: string
          domain_id: string
          end_date: string | null
          id: string
          name: string
          order_index: number | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closing_note?: string | null
          created_at?: string
          domain_id: string
          end_date?: string | null
          id?: string
          name: string
          order_index?: number | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closing_note?: string | null
          created_at?: string
          domain_id?: string
          end_date?: string | null
          id?: string
          name?: string
          order_index?: number | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      run_iterations: {
        Row: {
          change: string | null
          created_at: string
          element_id: string
          id: string
          kept: boolean | null
          n: number
          note: string | null
          run_id: string
          value: number | null
        }
        Insert: {
          change?: string | null
          created_at?: string
          element_id: string
          id?: string
          kept?: boolean | null
          n: number
          note?: string | null
          run_id: string
          value?: number | null
        }
        Update: {
          change?: string | null
          created_at?: string
          element_id?: string
          id?: string
          kept?: boolean | null
          n?: number
          note?: string | null
          run_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "run_iterations_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_iterations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          activity_space_id: string | null
          color: string | null
          created_at: string
          created_by: string
          definition_id: string | null
          delegation: string
          description: string | null
          icon: string | null
          id: string
          name: string
          scope: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          activity_space_id?: string | null
          color?: string | null
          created_at?: string
          created_by: string
          definition_id?: string | null
          delegation?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          scope?: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          activity_space_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string
          definition_id?: string | null
          delegation?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          scope?: Json
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategies_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_children: {
        Row: {
          child_strategy_id: string
          created_at: string
          order_index: number
          parent_strategy_id: string
        }
        Insert: {
          child_strategy_id: string
          created_at?: string
          order_index?: number
          parent_strategy_id: string
        }
        Update: {
          child_strategy_id?: string
          created_at?: string
          order_index?: number
          parent_strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_children_child_strategy_id_fkey"
            columns: ["child_strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_children_parent_strategy_id_fkey"
            columns: ["parent_strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_comments: {
        Row: {
          author_id: string | null
          author_kind: string
          author_name: string | null
          content: string
          created_at: string
          id: string
          is_pinned: boolean
          mentions: string[]
          parent_id: string | null
          strategy_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_kind?: string
          author_name?: string | null
          content: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          mentions?: string[]
          parent_id?: string | null
          strategy_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_kind?: string
          author_name?: string | null
          content?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          mentions?: string[]
          parent_id?: string | null
          strategy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "strategy_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_comments_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_objects: {
        Row: {
          created_at: string
          id: string
          object_id: string
          strategy_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          object_id: string
          strategy_id: string
        }
        Update: {
          created_at?: string
          id?: string
          object_id?: string
          strategy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_objects_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_objects_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      table_cells: {
        Row: {
          column_id: string
          row_id: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          column_id: string
          row_id: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          column_id?: string
          row_id?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "table_cells_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "table_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_cells_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "table_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      table_columns: {
        Row: {
          created_at: string
          id: string
          name: string
          options: Json | null
          order_index: number
          table_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          options?: Json | null
          order_index?: number
          table_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          options?: Json | null
          order_index?: number
          table_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_columns_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_rows: {
        Row: {
          created_at: string
          id: string
          order_index: number
          table_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_index?: number
          table_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_index?: number
          table_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_rows_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          description: string | null
          domain_id: string | null
          folder_id: string | null
          icon: string | null
          id: string
          name: string
          order_index: number | null
          status: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          domain_id?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          name: string
          order_index?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          domain_id?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          name?: string
          order_index?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          convert_emoticons: boolean
          created_at: string
          display_names: string
          first_day_of_week: string
          home_view: string
          send_comment_shortcut: string
          timeline_months_ahead: number
          timeline_months_back: number
          timeline_progress_fill: boolean
          timeline_scale: string
          timeline_today_marker: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          convert_emoticons?: boolean
          created_at?: string
          display_names?: string
          first_day_of_week?: string
          home_view?: string
          send_comment_shortcut?: string
          timeline_months_ahead?: number
          timeline_months_back?: number
          timeline_progress_fill?: boolean
          timeline_scale?: string
          timeline_today_marker?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          convert_emoticons?: boolean
          created_at?: string
          display_names?: string
          first_day_of_week?: string
          home_view?: string
          send_comment_shortcut?: string
          timeline_months_ahead?: number
          timeline_months_back?: number
          timeline_progress_fill?: boolean
          timeline_scale?: string
          timeline_today_marker?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      widget_boards: {
        Row: {
          board_key: string
          id: string
          layout: Json
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          board_key: string
          id?: string
          layout: Json
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Update: {
          board_key?: string
          id?: string
          layout?: Json
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      widget_documents: {
        Row: {
          part: string
          revision: number
          updated_at: string
          updated_by: string | null
          value: Json
          widget_id: string
        }
        Insert: {
          part: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
          value?: Json
          widget_id: string
        }
        Update: {
          part?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
          value?: Json
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_documents_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_viewer_state: {
        Row: {
          updated_at: string
          user_id: string
          value: Json
          widget_id: string
        }
        Insert: {
          updated_at?: string
          user_id?: string
          value?: Json
          widget_id: string
        }
        Update: {
          updated_at?: string
          user_id?: string
          value?: Json
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_viewer_state_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      widgets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          origin_id: string
          origin_kind: string
          params: Json
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          origin_id: string
          origin_kind: string
          params?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          origin_id?: string
          origin_kind?: string
          params?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      work_import_receipts: {
        Row: {
          activity_space_id: string
          created_at: string
          created_by: string
          id: string
          object_id: string | null
          outcome: string
          request: Json
          result: Json
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          created_by: string
          id: string
          object_id?: string | null
          outcome?: string
          request: Json
          result: Json
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          created_by?: string
          id?: string
          object_id?: string | null
          outcome?: string
          request?: Json
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "work_import_receipts_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_availability: {
        Row: {
          capacity_hours_per_day: number
          created_at: string
          end_date: string
          id: string
          kind: string
          note: string | null
          start_date: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          capacity_hours_per_day?: number
          created_at?: string
          end_date: string
          id?: string
          kind?: string
          note?: string | null
          start_date: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          capacity_hours_per_day?: number
          created_at?: string
          end_date?: string
          id?: string
          kind?: string
          note?: string | null
          start_date?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_availability_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_skill_evidence: {
        Row: {
          created_at: string
          element_id: string
          skill_id: string
        }
        Insert: {
          created_at?: string
          element_id: string
          skill_id: string
        }
        Update: {
          created_at?: string
          element_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_skill_evidence_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "worker_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_skills: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          level: number
          name: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          level?: number
          name: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          level?: number
          name?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          activity_space_id: string | null
          ai_config: Json | null
          ai_model: string | null
          avatar_url: string | null
          capacity_hours_per_day: number | null
          created_at: string | null
          display_id: string | null
          email: string | null
          id: string
          name: string
          object_id: string | null
          role: string | null
          seq_number: number | null
          status: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          activity_space_id?: string | null
          ai_config?: Json | null
          ai_model?: string | null
          avatar_url?: string | null
          capacity_hours_per_day?: number | null
          created_at?: string | null
          display_id?: string | null
          email?: string | null
          id?: string
          name: string
          object_id?: string | null
          role?: string | null
          seq_number?: number | null
          status?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          activity_space_id?: string | null
          ai_config?: Json | null
          ai_model?: string | null
          avatar_url?: string | null
          capacity_hours_per_day?: number | null
          created_at?: string | null
          display_id?: string | null
          email?: string | null
          id?: string
          name?: string
          object_id?: string | null
          role?: string | null
          seq_number?: number | null
          status?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_new_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_approvals: {
        Row: {
          activity_space_id: string
          connector: string
          consumed_at: string | null
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          deployment_id: string
          expires_at: string
          gateway_key_id: string
          id: string
          input_hash: string
          operation: string
          request_id: string
          requested_at: string
          run_external_id: string
          status: string
          summary: string
        }
        Insert: {
          activity_space_id: string
          connector: string
          consumed_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          deployment_id: string
          expires_at: string
          gateway_key_id: string
          id?: string
          input_hash: string
          operation: string
          request_id: string
          requested_at?: string
          run_external_id: string
          status?: string
          summary: string
        }
        Update: {
          activity_space_id?: string
          connector?: string
          consumed_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          deployment_id?: string
          expires_at?: string
          gateway_key_id?: string
          id?: string
          input_hash?: string
          operation?: string
          request_id?: string
          requested_at?: string
          run_external_id?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_approvals_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "workflow_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_approvals_gateway_key_id_fkey"
            columns: ["gateway_key_id"]
            isOneToOne: false
            referencedRelation: "workflow_gateway_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_deployments: {
        Row: {
          activity_space_id: string
          created_at: string
          created_by: string | null
          domain_id: string | null
          id: string
          minutes_per_item: number | null
          name: string
          object_id: string | null
          state: string
          template_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          created_by?: string | null
          domain_id?: string | null
          id?: string
          minutes_per_item?: number | null
          name: string
          object_id?: string | null
          state?: string
          template_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          created_by?: string | null
          domain_id?: string | null
          id?: string
          minutes_per_item?: number | null
          name?: string
          object_id?: string | null
          state?: string
          template_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_deployments_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_deployments_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_deployments_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_deployments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_deployments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_gateway_keys: {
        Row: {
          activity_space_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          public_key: string
          revoked_at: string | null
        }
        Insert: {
          activity_space_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          public_key: string
          revoked_at?: string | null
        }
        Update: {
          activity_space_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          public_key?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_gateway_keys_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_intake_batches: {
        Row: {
          activity_space_id: string
          batch_id: string
          body_digest: string
          gateway_key_id: string
          id: string
          reason: string | null
          received_at: string
          runs_added: number
          status: string
          steps_added: number
        }
        Insert: {
          activity_space_id: string
          batch_id: string
          body_digest: string
          gateway_key_id: string
          id?: string
          reason?: string | null
          received_at?: string
          runs_added?: number
          status: string
          steps_added?: number
        }
        Update: {
          activity_space_id?: string
          batch_id?: string
          body_digest?: string
          gateway_key_id?: string
          id?: string
          reason?: string | null
          received_at?: string
          runs_added?: number
          status?: string
          steps_added?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_intake_batches_activity_space_id_fkey"
            columns: ["activity_space_id"]
            isOneToOne: false
            referencedRelation: "activity_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_intake_batches_gateway_key_id_fkey"
            columns: ["gateway_key_id"]
            isOneToOne: false
            referencedRelation: "workflow_gateway_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_run_steps: {
        Row: {
          activity_space_id: string
          actor_kind: string
          actor_name: string | null
          connector: string | null
          deployment_id: string
          duration_ms: number | null
          event_id: string | null
          gateway_digest: string | null
          gateway_key_id: string | null
          grants_version: number | null
          hash: string
          id: string
          kind: string
          occurred_at: string
          operation: string
          outside_grant: boolean
          prev_hash: string
          reason: string | null
          received_at: string
          result: string
          run_id: string
          seq: number
          step_key: string
        }
        Insert: {
          activity_space_id: string
          actor_kind: string
          actor_name?: string | null
          connector?: string | null
          deployment_id: string
          duration_ms?: number | null
          event_id?: string | null
          gateway_digest?: string | null
          gateway_key_id?: string | null
          grants_version?: number | null
          hash: string
          id?: string
          kind: string
          occurred_at: string
          operation?: string
          outside_grant?: boolean
          prev_hash: string
          reason?: string | null
          received_at?: string
          result: string
          run_id: string
          seq: number
          step_key: string
        }
        Update: {
          activity_space_id?: string
          actor_kind?: string
          actor_name?: string | null
          connector?: string | null
          deployment_id?: string
          duration_ms?: number | null
          event_id?: string | null
          gateway_digest?: string | null
          gateway_key_id?: string | null
          grants_version?: number | null
          hash?: string
          id?: string
          kind?: string
          occurred_at?: string
          operation?: string
          outside_grant?: boolean
          prev_hash?: string
          reason?: string | null
          received_at?: string
          result?: string
          run_id?: string
          seq?: number
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_run_steps_gateway_key_id_fkey"
            columns: ["gateway_key_id"]
            isOneToOne: false
            referencedRelation: "workflow_gateway_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          activity_space_id: string
          deployment_id: string
          external_id: string
          id: string
          received_at: string
          started_at: string
          subject_digest: string | null
          subject_ref: string | null
          template_version: number
        }
        Insert: {
          activity_space_id: string
          deployment_id: string
          external_id: string
          id?: string
          received_at?: string
          started_at: string
          subject_digest?: string | null
          subject_ref?: string | null
          template_version: number
        }
        Update: {
          activity_space_id?: string
          deployment_id?: string
          external_id?: string
          id?: string
          received_at?: string
          started_at?: string
          subject_digest?: string | null
          subject_ref?: string | null
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "workflow_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string
          id: string
          key: string
          name: string
          purpose: string
          steps: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          name: string
          purpose?: string
          steps?: Json
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          name?: string
          purpose?: string
          steps?: Json
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_asset: { Args: { p_asset_id: string }; Returns: undefined }
      add_widget: {
        Args: {
          p_board_id: string
          p_kind: string
          p_params?: Json
          p_personal?: boolean
          p_position?: number
          p_singleton?: boolean
          p_size?: string
          p_zone: string
        }
        Returns: string
      }
      alcon_restoring: { Args: never; Returns: boolean }
      announce_asset: {
        Args: {
          p_kind: string
          p_manifest: Json
          p_name: string
          p_observed: Json
          p_space: string
          p_token_hash: string
          p_token_prefix: string
        }
        Returns: string
      }
      archive_object: { Args: { p_object: string }; Returns: string }
      attachment_owner_visible: {
        Args: { kind: string; owner: string }
        Returns: boolean
      }
      attachment_version_prunable: { Args: { p_id: string }; Returns: boolean }
      attachments_to_index: {
        Args: { p_limit?: number; p_space: string }
        Returns: {
          id: string
          mime_type: string
          name: string
          path: string
          size: number
        }[]
      }
      audit_ledger_runs: {
        Args: { _limit?: number; _since: string; _space_id: string }
        Returns: Json
      }
      board_presence_allowed: { Args: { p_topic: string }; Returns: boolean }
      can_edit_domain_approaches: {
        Args: { p_domain_id: string }
        Returns: boolean
      }
      cancel_invite: { Args: { p_invitation: string }; Returns: undefined }
      check_in_element: {
        Args: {
          p_element_id: string
          p_expected_updated_at: string
          p_note?: string
          p_patch?: Json
          p_request_id: string
        }
        Returns: Json
      }
      claim_element: {
        Args: { p_branch?: string; p_element_id: string; p_holder: string }
        Returns: boolean
      }
      coordination_element_in_space: {
        Args: { p_element_id: string; p_space_id: string }
        Returns: boolean
      }
      create_personal_access_token: {
        Args: { p_access?: string; p_expires_days?: number; p_name: string }
        Returns: Json
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      decide_workflow_approval: {
        Args: { _approval_id: string; _approve: boolean; _note?: string }
        Returns: Json
      }
      describe_function: { Args: { fn_name: string }; Returns: string }
      edit_approach_plan_item: {
        Args: {
          p_id: string
          p_kind: string
          p_patch: Json
          p_revision: number
        }
        Returns: undefined
      }
      element_lease_ttl: { Args: never; Returns: string }
      element_space: { Args: { p_element_id: string }; Returns: string }
      ensure_board: {
        Args: {
          p_instances?: Json
          p_space_id?: string
          p_subject_id?: string
          p_subject_kind: string
          p_surface: string
        }
        Returns: string
      }
      file_presence_allowed: { Args: { p_topic: string }; Returns: boolean }
      generate_due_soon_notifications: { Args: never; Returns: undefined }
      generate_prefix: { Args: { name: string }; Returns: string }
      generate_review_due_notifications: { Args: never; Returns: undefined }
      get_element_activity: {
        Args: { p_element_ids: string[] }
        Returns: {
          comment_count: number
          element_id: string
          last_comment_at: string
        }[]
      }
      get_explorer_data: {
        Args: { p_domain_id?: string; p_object_id?: string }
        Returns: Json
      }
      get_integration_secret: {
        Args: { p_integration_id: string }
        Returns: string
      }
      get_my_elements: { Args: never; Returns: Json }
      get_now_work: { Args: { p_space_id: string }; Returns: Json }
      get_space_guest_domain_members: {
        Args: { p_space_id: string }
        Returns: {
          domain_id: string
          domain_name: string
          domain_role: string
          user_id: string
        }[]
      }
      import_existing_work: {
        Args: {
          p_batch_id: string
          p_domain_id: string
          p_object_id: string
          p_project_name: string
          p_rows: Json
          p_space_id: string
        }
        Returns: Json
      }
      intent_measure_format: {
        Args: { p_unit: string; p_value: number }
        Returns: string
      }
      intent_measure_state: {
        Args: { p_direction: string; p_target: number; p_value: number }
        Returns: string
      }
      invite_member: {
        Args: {
          p_role?: string
          p_scope: string
          p_scope_id: string
          p_user: string
        }
        Returns: string
      }
      is_activity_space_member: { Args: { p_space: string }; Returns: boolean }
      is_activity_space_owner: { Args: { p_space: string }; Returns: boolean }
      is_delegated_request: { Args: never; Returns: boolean }
      list_assignable_workers: {
        Args: {
          p_domain_id?: string
          p_element_id?: string
          p_include_inactive?: boolean
          p_space_id?: string
        }
        Returns: {
          activity_space_id: string | null
          ai_config: Json | null
          ai_model: string | null
          avatar_url: string | null
          capacity_hours_per_day: number | null
          created_at: string | null
          display_id: string | null
          email: string | null
          id: string
          name: string
          object_id: string | null
          role: string | null
          seq_number: number | null
          status: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "workers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_table_policies: {
        Args: { target_table: string }
        Returns: {
          cmd: string
          permissive: string
          policy_name: string
          qual: string
          roles: string[]
          with_check: string
        }[]
      }
      list_table_triggers: {
        Args: { target_table: string }
        Returns: {
          events: string
          function_name: string
          trigger_name: string
          when: string
        }[]
      }
      merge_domain_label_colors: {
        Args: { p_domain_id: string; p_remove: string[]; p_set: Json }
        Returns: Json
      }
      merge_widget_document: {
        Args: {
          p_part: string
          p_set?: Json
          p_unset?: string[]
          p_widget_id: string
        }
        Returns: {
          part: string
          revision: number
          updated_at: string
          updated_by: string | null
          value: Json
          widget_id: string
        }
        SetofOptions: {
          from: "*"
          to: "widget_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      merge_widget_params: {
        Args: { p_patch: Json; p_widget_id: string }
        Returns: Json
      }
      note_presence_allowed: { Args: { p_topic: string }; Returns: boolean }
      notify_about_element: {
        Args: { p_element_id: string; p_kind: string; p_worker_id?: string }
        Returns: number
      }
      record_asset_events: {
        Args: { p_asset_id: string; p_events: Json }
        Returns: number
      }
      release_element: {
        Args: { p_element_id: string; p_holder: string }
        Returns: boolean
      }
      rename_object_prefix: {
        Args: { p_new_prefix: string; p_object_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          color: string | null
          created_at: string | null
          description: string | null
          display_id: string | null
          domain_id: string | null
          due_date: string | null
          id: string
          lead_id: string | null
          name: string
          note_id: string | null
          order_index: number | null
          phase_id: string | null
          prefix: string | null
          start_date: string | null
          system_id: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_board: { Args: { p_board_id: string }; Returns: undefined }
      resolve_asset_token: {
        Args: { p_hash: string }
        Returns: {
          activity_space_id: string
          claimed_at: string
          id: string
          name: string
          status: string
        }[]
      }
      resolve_oauth_caller: {
        Args: { p_client_id: string; p_user_id: string }
        Returns: {
          access: string
          client_name: string
        }[]
      }
      resolve_personal_access_token: {
        Args: { p_client?: string; p_hash: string }
        Returns: {
          access: string
          id: string
          name: string
          user_id: string
        }[]
      }
      resolve_work_import: {
        Args: { p_batch_id: string; p_space_id: string }
        Returns: Json
      }
      respond_to_invite: {
        Args: { p_accept: boolean; p_invitation: string }
        Returns: string
      }
      restore_element: { Args: { p_deletion: string }; Returns: string }
      restore_object: { Args: { p_object: string }; Returns: undefined }
      revoke_asset: { Args: { p_asset_id: string }; Returns: undefined }
      revoke_personal_access_token: {
        Args: { p_id: string }
        Returns: undefined
      }
      search_attachments: {
        Args: { p_limit?: number; p_query: string; p_space: string }
        Returns: {
          domain_id: string
          element_id: string
          element_object_id: string
          folder_id: string
          id: string
          mime_type: string
          name: string
          object_id: string
          owner_label: string
          snippet: string
          strategy_id: string
        }[]
      }
      set_domain_member_role: {
        Args: { p_domain: string; p_role: string; p_user: string }
        Returns: string
      }
      set_element_dependency: {
        Args: {
          p_downstream_id: string
          p_remove?: boolean
          p_space_id: string
          p_upstream_id: string
        }
        Returns: Json
      }
      set_integration_secret: {
        Args: { p_integration_id: string; p_secret: string }
        Returns: undefined
      }
      set_oauth_client_access: {
        Args: { p_access: string; p_client_id: string }
        Returns: undefined
      }
      space_ai_spend_this_month: {
        Args: { p_space_id: string }
        Returns: number
      }
      space_attachments: {
        Args: { p_space: string; p_trashed?: boolean }
        Returns: {
          created_at: string
          deleted_at: string
          domain_id: string
          element_id: string
          element_object_id: string
          folder_id: string
          id: string
          mime_type: string
          name: string
          object_id: string
          owner_label: string
          path: string
          previous_id: string
          size: number
          strategy_id: string
          uploaded_by: string
          versions: number
        }[]
      }
      stash_integration_oauth_pending: {
        Args: {
          p_account: string
          p_completion_hash: string
          p_flow_id: string
          p_secret: string
        }
        Returns: undefined
      }
      store_integration_oauth_token: {
        Args: {
          p_expected_refresh_hash?: string
          p_integration_id: string
          p_secret: string
        }
        Returns: boolean
      }
      strategy_object_visible: {
        Args: { _strategy_id: string }
        Returns: boolean
      }
      table_row_counts: {
        Args: { p_table_ids: string[] }
        Returns: {
          row_count: number
          table_id: string
        }[]
      }
      take_integration_oauth_pending: {
        Args: { p_completion_hash: string }
        Returns: {
          account: string
          flow_expires_at: string
          flow_integration_id: string
          flow_user_id: string
          token_set: string
        }[]
      }
      touch_asset: {
        Args: { p_asset_id: string; p_manifest: Json; p_observed: Json }
        Returns: undefined
      }
      user_can_decide_approval: {
        Args: { p_element: string }
        Returns: boolean
      }
      user_can_manage_approval: {
        Args: { p_element: string }
        Returns: boolean
      }
      user_can_read_domain: { Args: { _domain_id: string }; Returns: boolean }
      user_can_read_element: { Args: { _element_id: string }; Returns: boolean }
      user_can_read_object: { Args: { _object_id: string }; Returns: boolean }
      user_can_read_strategy: {
        Args: { _strategy_id: string }
        Returns: boolean
      }
      user_can_read_widget_subject: {
        Args: { _id: string; _kind: string }
        Returns: boolean
      }
      user_can_see_code_change: {
        Args: { p_code_change_id: string }
        Returns: boolean
      }
      user_can_see_deployment: {
        Args: { _deployment_id: string }
        Returns: boolean
      }
      user_can_see_domain: { Args: { _domain_id: string }; Returns: boolean }
      user_can_see_element: { Args: { _element_id: string }; Returns: boolean }
      user_can_see_note: { Args: { _note_id: string }; Returns: boolean }
      user_can_see_object: { Args: { _object_id: string }; Returns: boolean }
      user_can_see_strategy: {
        Args: { _strategy_id: string }
        Returns: boolean
      }
      user_can_see_widget_subject: {
        Args: { _id: string; _kind: string }
        Returns: boolean
      }
      user_has_domain_role: {
        Args: { _domain_id: string; _roles: string[] }
        Returns: boolean
      }
      user_has_object_role: {
        Args: { _object_id: string; _roles: string[] }
        Returns: boolean
      }
      user_is_domain_member: { Args: { _domain_id: string }; Returns: boolean }
      user_is_object_member: { Args: { _object_id: string }; Returns: boolean }
      user_owns_intent: { Args: { p_intent_id: string }; Returns: boolean }
      widget_is_placed: { Args: { _widget_id: string }; Returns: boolean }
      worker_assignable: {
        Args: { p_element: string; p_worker: string }
        Returns: boolean
      }
      workflow_approval_redeem: {
        Args: { _approval_id: string; _input_hash: string; _key_id: string }
        Returns: Json
      }
      workflow_approval_request: {
        Args: {
          _connector: string
          _deployment_id: string
          _input_hash: string
          _key_id: string
          _operation: string
          _request_id: string
          _run_external_id: string
          _summary: string
          _valid_minutes: number
        }
        Returns: Json
      }
      workflow_chain_field: { Args: { _value: string }; Returns: string }
      workflow_grants_table: { Args: { _key_id: string }; Returns: Json }
      workflow_intake: {
        Args: {
          _batch_id: string
          _body_digest: string
          _key_id: string
          _runs: Json
          _steps: Json
        }
        Returns: Json
      }
      workflow_intake_reject: {
        Args: {
          _batch_id: string
          _body_digest: string
          _key_id: string
          _reason: string
        }
        Returns: undefined
      }
      workflow_step_outside_grant: {
        Args: {
          _connector: string
          _deployment_id: string
          _occurred_at: string
          _operation: string
          _version: number
        }
        Returns: boolean
      }
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
