export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      branches: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          created_at: string
          error: string | null
          event: string
          id: string
          order_id: string | null
          payload: Json | null
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          restaurant_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          is_available: boolean
          max_select: number
          min_select: number
          name: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_available?: boolean
          max_select?: number
          min_select?: number
          name: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_available?: boolean
          max_select?: number
          min_select?: number
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          group_id: string
          id: string
          is_available: boolean
          name: string
          price_delta: number
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          is_available?: boolean
          name: string
          price_delta?: number
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          is_available?: boolean
          name?: string
          price_delta?: number
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          group_id: string | null
          group_name: string
          id: string
          option_id: string | null
          option_name: string
          order_item_id: string
          price_delta: number
        }
        Insert: {
          group_id?: string | null
          group_name: string
          id?: string
          option_id?: string | null
          option_name: string
          order_item_id: string
          price_delta?: number
        }
        Update: {
          group_id?: string | null
          group_name?: string
          id?: string
          option_id?: string | null
          option_name?: string
          order_item_id?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_removed_ingredients: {
        Row: {
          id: string
          ingredient_id: string | null
          ingredient_name: string
          order_item_id: string
        }
        Insert: {
          id?: string
          ingredient_id?: string | null
          ingredient_name: string
          order_item_id: string
        }
        Update: {
          id?: string
          ingredient_id?: string | null
          ingredient_name?: string
          order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_removed_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "product_ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_removed_ingredients_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          base_price: number
          id: string
          is_shared: boolean
          notes: string | null
          order_id: string
          participant_id: string | null
          product_id: string | null
          product_name: string
          quantity: number
          total_price: number
        }
        Insert: {
          base_price: number
          id?: string
          is_shared?: boolean
          notes?: string | null
          order_id: string
          participant_id?: string | null
          product_id?: string | null
          product_name: string
          quantity: number
          total_price: number
        }
        Update: {
          base_price?: number
          id?: string
          is_shared?: boolean
          notes?: string | null
          order_id?: string
          participant_id?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          notes: string | null
          preparing_at: string | null
          ready_at: string | null
          request_id: string | null
          request_payload: Json | null
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["order_status"]
          submitted_by: string | null
          total_amount: number
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          request_id?: string | null
          request_payload?: Json | null
          restaurant_id: string
          session_id: string
          status?: Database["public"]["Enums"]["order_status"]
          submitted_by?: string | null
          total_amount?: number
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          request_id?: string | null
          request_payload?: Json | null
          restaurant_id?: string
          session_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          submitted_by?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id: string | null
          participant_id: string | null
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          mode: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id?: string | null
          participant_id?: string | null
          restaurant_id: string
          session_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id?: string | null
          participant_id?: string | null
          restaurant_id?: string
          session_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_integrations: {
        Row: {
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          restaurant_id: string
          type: Database["public"]["Enums"]["pos_type"]
        }
        Insert: {
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          restaurant_id: string
          type?: Database["public"]["Enums"]["pos_type"]
        }
        Update: {
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          restaurant_id?: string
          type?: Database["public"]["Enums"]["pos_type"]
        }
        Relationships: [
          {
            foreignKeyName: "pos_integrations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_mappings: {
        Row: {
          external_id: string
          id: string
          product_id: string
          restaurant_id: string
        }
        Insert: {
          external_id: string
          id?: string
          product_id: string
          restaurant_id: string
        }
        Update: {
          external_id?: string
          id?: string
          product_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_product_mappings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          id: string
          is_available: boolean
          is_removable: boolean
          name: string
          product_id: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          is_available?: boolean
          is_removable?: boolean
          name: string
          product_id: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          is_available?: boolean
          is_removable?: boolean
          name?: string
          product_id?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_modifier_groups: {
        Row: {
          group_id: string
          id: string
          product_id: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          product_id: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          product_id?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price: number
          category_id: string
          created_at: string
          description: string | null
          dietary_tags: string[]
          food_info: string | null
          id: string
          is_available: boolean
          media_urls: string[]
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          base_price: number
          category_id: string
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          food_info?: string | null
          id?: string
          is_available?: boolean
          media_urls?: string[]
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          base_price?: number
          category_id?: string
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          food_info?: string | null
          id?: string
          is_available?: boolean
          media_urls?: string[]
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_members: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_members_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          menu_design: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          menu_design?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          menu_design?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      session_participants: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          closed_at: string | null
          id: string
          opened_at: string
          restaurant_id: string
          status: Database["public"]["Enums"]["session_status"]
          table_id: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          opened_at?: string
          restaurant_id: string
          status?: Database["public"]["Enums"]["session_status"]
          table_id: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          opened_at?: string
          restaurant_id?: string
          status?: Database["public"]["Enums"]["session_status"]
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          qr_token: string
          restaurant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          qr_token?: string
          restaurant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          qr_token?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      session_bills: {
        Row: {
          is_settled: boolean | null
          paid_amount: number | null
          pending_amount: number | null
          restaurant_id: string | null
          session_id: string | null
          submitted_amount: number | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      close_table_session: { Args: { p_session_id: string }; Returns: string }
      dispatch_internal_order: { Args: { p_order_id: string }; Returns: string }
      get_order_pos_type: {
        Args: { p_order_id: string }
        Returns: Database["public"]["Enums"]["pos_type"]
      }
      is_restaurant_member: { Args: { rid: string }; Returns: boolean }
      is_session_participant: { Args: { sid: string }; Returns: boolean }
      join_table_session: {
        Args: { participant_name?: string; qr: string }
        Returns: string
      }
      submit_order: {
        Args: {
          p_expected_total: number
          p_items: Json
          p_notes?: string
          p_request_id: string
          p_session_id: string
        }
        Returns: string
      }
      transition_order: {
        Args: {
          p_order_id: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: string
      }
    }
    Enums: {
      member_role: "owner" | "staff"
      order_status:
        | "submitted"
        | "accepted"
        | "in_preparation"
        | "ready"
        | "delivered"
        | "cancelled"
      payment_mode: "full" | "own" | "equal_split" | "custom"
      payment_status: "pending" | "approved" | "rejected" | "cancelled"
      pos_type: "internal" | "fudo"
      session_status: "open" | "closed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      member_role: ["owner", "staff"],
      order_status: [
        "submitted",
        "accepted",
        "in_preparation",
        "ready",
        "delivered",
        "cancelled",
      ],
      payment_mode: ["full", "own", "equal_split", "custom"],
      payment_status: ["pending", "approved", "rejected", "cancelled"],
      pos_type: ["internal", "fudo"],
      session_status: ["open", "closed"],
    },
  },
} as const

