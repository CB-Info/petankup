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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      matches: {
        Row: {
          created_at: string
          id: string
          round_number: number
          score_a: number | null
          score_b: number | null
          status: Database["public"]["Enums"]["match_status"]
          team_a_id: string
          team_b_id: string
          tournament_id: string
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          round_number: number
          score_a?: number | null
          score_b?: number | null
          status?: Database["public"]["Enums"]["match_status"]
          team_a_id: string
          team_b_id: string
          tournament_id: string
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          round_number?: number
          score_a?: number | null
          score_b?: number | null
          status?: Database["public"]["Enums"]["match_status"]
          team_a_id?: string
          team_b_id?: string
          tournament_id?: string
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_team_a_same_tournament_fkey"
            columns: ["team_a_id", "tournament_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "tournament_id"]
          },
          {
            foreignKeyName: "matches_team_b_same_tournament_fkey"
            columns: ["team_b_id", "tournament_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "tournament_id"]
          },
          {
            foreignKeyName: "matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_players: {
        Row: {
          created_at: string
          display_name: string
          id: string
          team_id: string
          tournament_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          team_id: string
          tournament_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          team_id?: string
          tournament_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_players_team_belongs_to_tournament"
            columns: ["team_id", "tournament_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "tournament_id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          tournament_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tournament_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_members: {
        Row: {
          created_at: string
          id: string
          member_email: string
          tournament_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_email: string
          tournament_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_email?: string
          tournament_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_members_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          completed_at: string | null
          created_at: string
          date: string
          description: string | null
          format: Database["public"]["Enums"]["tournament_format"]
          id: string
          location: string | null
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["tournament_status"]
          updated_at: string
          visibility: Database["public"]["Enums"]["tournament_visibility"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          date: string
          description?: string | null
          format?: Database["public"]["Enums"]["tournament_format"]
          id?: string
          location?: string | null
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["tournament_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["tournament_visibility"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          date?: string
          description?: string | null
          format?: Database["public"]["Enums"]["tournament_format"]
          id?: string
          location?: string | null
          name?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["tournament_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["tournament_visibility"]
        }
        Relationships: []
      }
      user_stats: {
        Row: {
          last_tournament_at: string | null
          last_updated: string
          losses: number
          matches_played: number
          podiums: number
          points_conceded: number
          points_scored: number
          tournaments_played: number
          tournaments_won: number
          user_id: string
          wins: number
        }
        Insert: {
          last_tournament_at?: string | null
          last_updated?: string
          losses?: number
          matches_played?: number
          podiums?: number
          points_conceded?: number
          points_scored?: number
          tournaments_played?: number
          tournaments_won?: number
          user_id: string
          wins?: number
        }
        Update: {
          last_tournament_at?: string | null
          last_updated?: string
          losses?: number
          matches_played?: number
          podiums?: number
          points_conceded?: number
          points_scored?: number
          tournaments_played?: number
          tournaments_won?: number
          user_id?: string
          wins?: number
        }
        Relationships: []
      }
      user_tournament_results: {
        Row: {
          final_rank: number
          is_podium: boolean
          is_winner: boolean
          losses: number
          points_conceded: number
          points_scored: number
          team_id: string
          tournament_completed_at: string
          tournament_id: string
          user_id: string
          wins: number
        }
        Insert: {
          final_rank: number
          is_podium?: boolean
          is_winner?: boolean
          losses?: number
          points_conceded?: number
          points_scored?: number
          team_id: string
          tournament_completed_at: string
          tournament_id: string
          user_id: string
          wins?: number
        }
        Update: {
          final_rank?: number
          is_podium?: boolean
          is_winner?: boolean
          losses?: number
          points_conceded?: number
          points_scored?: number
          team_id?: string
          tournament_completed_at?: string
          tournament_id?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_tournament_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tournament_results_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_team_with_players: {
        Args: { p_name: string; p_players: Json; p_tournament_id: string }
        Returns: string
      }
      get_user_profile: {
        Args: { p_user_id: string }
        Returns: Json
      }
      invite_tournament_member_by_display_name: {
        Args: { p_display_name: string; p_tournament_id: string }
        Returns: {
          created_at: string
          id: string
          member_email: string
          tournament_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tournament_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_tournament_member: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      text_array_has_no_blank_values: {
        Args: { arr: string[] }
        Returns: boolean
      }
      update_team_with_players: {
        Args: { p_name: string; p_players: Json; p_team_id: string }
        Returns: string
      }
    }
    Enums: {
      match_status: "pending" | "completed"
      tournament_format: "round_robin"
      tournament_status: "draft" | "in_progress" | "completed"
      tournament_visibility: "private" | "public"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      match_status: ["pending", "completed"],
      tournament_format: ["round_robin"],
      tournament_status: ["draft", "in_progress", "completed"],
      tournament_visibility: ["private", "public"],
    },
  },
} as const
