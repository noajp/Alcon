export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_dependency_analyses: {
        Row: {
          affected_departments: string[] | null
          analysis_type: string
          company_id: string
          confidence_score: number | null
          cost_jpy: number | null
          created_at: string | null
          discovered_chain: Json
          id: string
          impact_score: number | null
          notified_to: string[] | null
          recommended_actions: Json | null
          resolved_at: string | null
          status: string | null
          tokens_used: number | null
          trigger_task_id: string | null
        }
        Insert: {
          affected_departments?: string[] | null
          analysis_type: string
          company_id: string
          confidence_score?: number | null
          cost_jpy?: number | null
          created_at?: string | null
          discovered_chain: Json
          id?: string
          impact_score?: number | null
          notified_to?: string[] | null
          recommended_actions?: Json | null
          resolved_at?: string | null
          status?: string | null
          tokens_used?: number | null
          trigger_task_id?: string | null
        }
        Update: {
          affected_departments?: string[] | null
          analysis_type?: string
          company_id?: string
          confidence_score?: number | null
          cost_jpy?: number | null
          created_at?: string | null
          discovered_chain?: Json
          id?: string
          impact_score?: number | null
          notified_to?: string[] | null
          recommended_actions?: Json | null
          resolved_at?: string | null
          status?: string | null
          tokens_used?: number | null
          trigger_task_id?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          color: string | null
          company_id: string
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          company_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          company_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      members: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          role: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          role?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          role?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          analysis_id: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          member_id: string
          message: string
          title: string
          type: string | null
        }
        Insert: {
          analysis_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          member_id: string
          message: string
          title: string
          type?: string | null
        }
        Update: {
          analysis_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          member_id?: string
          message?: string
          title?: string
          type?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: string | null
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string | null
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string | null
          team_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sections: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          order_index: number | null
          project_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          order_index?: number | null
          project_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          order_index?: number | null
          project_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          created_at: string | null
          id: string
          is_completed: boolean | null
          order_index: number | null
          task_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_completed?: boolean | null
          order_index?: number | null
          task_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_completed?: boolean | null
          order_index?: number | null
          task_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      task_changes: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          task_id: string
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          task_id: string
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          task_id?: string
        }
        Relationships: []
      }
      task_dependencies: {
        Row: {
          created_at: string | null
          dependency_type: string | null
          depends_on_task_id: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string | null
          dependency_type?: string | null
          depends_on_task_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string | null
          dependency_type?: string | null
          depends_on_task_id?: string
          id?: string
          task_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          actual_hours: number | null
          assignee_id: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          order_index: number | null
          priority: string | null
          section_id: string
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_hours?: number | null
          assignee_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          order_index?: number | null
          priority?: string | null
          section_id: string
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_hours?: number | null
          assignee_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          order_index?: number | null
          priority?: string | null
          section_id?: string
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string | null
          department_id: string
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_id: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
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

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
