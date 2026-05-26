export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  graphql_public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
  public: {
    Tables: {
      assets: {
        Row: {
          amount: number;
          category: string;
          created_at: string;
          currency: string;
          id: string;
          is_liability: boolean;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          category: string;
          created_at?: string;
          currency: string;
          id?: string;
          is_liability?: boolean;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          category?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          is_liability?: boolean;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      auto_snapshot_log: {
        Row: {
          last_snapshot_month: string;
          user_id: string;
        };
        Insert: {
          last_snapshot_month: string;
          user_id: string;
        };
        Update: {
          last_snapshot_month?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      crypto_prices: {
        Row: {
          fetched_at: string;
          price_usd: number;
          symbol: string;
        };
        Insert: {
          fetched_at?: string;
          price_usd: number;
          symbol: string;
        };
        Update: {
          fetched_at?: string;
          price_usd?: number;
          symbol?: string;
        };
        Relationships: [];
      };
      exchange_rates: {
        Row: {
          currency_pair: string;
          fetched_at: string;
          rate: number;
        };
        Insert: {
          currency_pair: string;
          fetched_at?: string;
          rate: number;
        };
        Update: {
          currency_pair?: string;
          fetched_at?: string;
          rate?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_currency: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_currency?: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_currency?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      snapshots: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          snapshot_date: string;
          total_net_worth: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          currency: string;
          id?: string;
          snapshot_date?: string;
          total_net_worth: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          snapshot_date?: string;
          total_net_worth?: number;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      handle_monthly_auto_snapshot: {
        Args: { p_user_id: string };
        Returns: string;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends
    | (DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
        ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
        : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
          ? keyof DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
          : never)
    | never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;
/* eslint-enable @typescript-eslint/no-redundant-type-constituents */

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends
    | (PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
        ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
        : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
          ? keyof DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
          : never)
    | never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;
/* eslint-enable @typescript-eslint/no-redundant-type-constituents */

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
