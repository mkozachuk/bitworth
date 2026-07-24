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
      allocation_cards: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      allocation_targets: {
        Row: {
          asset_id: string;
          card_id: string;
          created_at: string;
          id: string;
          target_pct: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          asset_id: string;
          card_id: string;
          created_at?: string;
          id?: string;
          target_pct: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          asset_id?: string;
          card_id?: string;
          created_at?: string;
          id?: string;
          target_pct?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "allocation_targets_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocation_targets_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "allocation_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_categories: {
        Row: {
          created_at: string;
          display_order: number;
          icon: string | null;
          id: string;
          is_liability: boolean;
          name: string;
        };
        Insert: {
          created_at?: string;
          display_order: number;
          icon?: string | null;
          id: string;
          is_liability?: boolean;
          name: string;
        };
        Update: {
          created_at?: string;
          display_order?: number;
          icon?: string | null;
          id?: string;
          is_liability?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          amount: number;
          category_id: string;
          created_at: string;
          crypto_symbol: string | null;
          currency: string;
          id: string;
          metal_symbol: string | null;
          name: string;
          notes: string | null;
          quantity: number | null;
          show_on_chart: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          category_id: string;
          created_at?: string;
          crypto_symbol?: string | null;
          currency: string;
          id?: string;
          metal_symbol?: string | null;
          name: string;
          notes?: string | null;
          quantity?: number | null;
          show_on_chart?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          category_id?: string;
          created_at?: string;
          crypto_symbol?: string | null;
          currency?: string;
          id?: string;
          metal_symbol?: string | null;
          name?: string;
          notes?: string | null;
          quantity?: number | null;
          show_on_chart?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assets_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "asset_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      crypto_price_cache: {
        Row: {
          coin_id: string;
          coin_symbol: string;
          fetched_at: string;
          id: string;
          price_usd: number;
        };
        Insert: {
          coin_id: string;
          coin_symbol: string;
          fetched_at?: string;
          id?: string;
          price_usd: number;
        };
        Update: {
          coin_id?: string;
          coin_symbol?: string;
          fetched_at?: string;
          id?: string;
          price_usd?: number;
        };
        Relationships: [];
      };
      metal_price_cache: {
        Row: {
          fetched_at: string;
          id: string;
          metal_id: string;
          metal_symbol: string;
          price_usd: number;
        };
        Insert: {
          fetched_at?: string;
          id?: string;
          metal_id: string;
          metal_symbol: string;
          price_usd: number;
        };
        Update: {
          fetched_at?: string;
          id?: string;
          metal_id?: string;
          metal_symbol?: string;
          price_usd?: number;
        };
        Relationships: [];
      };
      exchange_rate_cache: {
        Row: {
          base_currency: string;
          fetched_at: string;
          rate: number;
          target_currency: string;
        };
        Insert: {
          base_currency: string;
          fetched_at?: string;
          rate: number;
          target_currency: string;
        };
        Update: {
          base_currency?: string;
          fetched_at?: string;
          rate?: number;
          target_currency?: string;
        };
        Relationships: [];
      };
      snapshot_items: {
        Row: {
          category_id: string;
          converted_amount: number;
          created_at: string;
          display_currency: string;
          display_order: number;
          exchange_rate_usd: number | null;
          id: string;
          name: string;
          original_amount: number;
          original_currency: string;
          snapshot_id: string;
        };
        Insert: {
          category_id: string;
          converted_amount: number;
          created_at?: string;
          display_currency: string;
          display_order?: number;
          exchange_rate_usd?: number | null;
          id?: string;
          name: string;
          original_amount: number;
          original_currency: string;
          snapshot_id: string;
        };
        Update: {
          category_id?: string;
          converted_amount?: number;
          created_at?: string;
          display_currency?: string;
          display_order?: number;
          exchange_rate_usd?: number | null;
          id?: string;
          name?: string;
          original_amount?: number;
          original_currency?: string;
          snapshot_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "snapshot_items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "asset_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "snapshot_items_snapshot_id_fkey";
            columns: ["snapshot_id"];
            isOneToOne: false;
            referencedRelation: "snapshots";
            referencedColumns: ["id"];
          },
        ];
      };
      snapshots: {
        Row: {
          base_currency: string;
          created_at: string;
          display_currency: string;
          id: string;
          net_contribution: number | null;
          note: string | null;
          source: string;
          total_net_worth: number;
          user_id: string;
        };
        Insert: {
          base_currency?: string;
          created_at?: string;
          display_currency: string;
          id?: string;
          net_contribution?: number | null;
          note?: string | null;
          source: string;
          total_net_worth: number;
          user_id: string;
        };
        Update: {
          base_currency?: string;
          created_at?: string;
          display_currency?: string;
          id?: string;
          net_contribution?: number | null;
          note?: string | null;
          source?: string;
          total_net_worth?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          created_at: string;
          display_currency: string;
          fire_annual_expenses: number | null;
          fire_annual_income: number | null;
          fire_barista_income: number | null;
          fire_current_age: number | null;
          fire_expected_return: number | null;
          fire_inflation_rate: number | null;
          fire_safe_withdrawal_rate: number;
          fire_starting_principal_override: number | null;
          fire_traditional_retirement_age: number;
          show_drift_alerts: boolean;
          show_fire_dashboard: boolean;
          show_trajectory: boolean;
          theme: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_currency?: string;
          fire_annual_expenses?: number | null;
          fire_annual_income?: number | null;
          fire_barista_income?: number | null;
          fire_current_age?: number | null;
          fire_expected_return?: number | null;
          fire_inflation_rate?: number | null;
          fire_safe_withdrawal_rate?: number;
          fire_starting_principal_override?: number | null;
          fire_traditional_retirement_age?: number;
          show_drift_alerts?: boolean;
          show_fire_dashboard?: boolean;
          show_trajectory?: boolean;
          theme?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_currency?: string;
          fire_annual_expenses?: number | null;
          fire_annual_income?: number | null;
          fire_barista_income?: number | null;
          fire_current_age?: number | null;
          fire_expected_return?: number | null;
          fire_inflation_rate?: number | null;
          fire_safe_withdrawal_rate?: number;
          fire_starting_principal_override?: number | null;
          fire_traditional_retirement_age?: number;
          show_drift_alerts?: boolean;
          show_fire_dashboard?: boolean;
          show_trajectory?: boolean;
          theme?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      restore_backup: {
        Args: { p_data: Json; p_mode: string };
        Returns: undefined;
      };
      upsert_crypto_price_cache: {
        Args: { p_coin_id: string; p_coin_symbol: string; p_price_usd: number };
        Returns: undefined;
      };
      upsert_metal_price_cache: {
        Args: { p_metal_id: string; p_metal_symbol: string; p_price_usd: number };
        Returns: undefined;
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

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
