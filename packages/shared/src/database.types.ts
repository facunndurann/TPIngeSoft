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
      abandoned_order_requests: {
        Row: {
          abandoned_at: string
          participant_id: string
          request_id: string
        }
        Insert: {
          abandoned_at?: string
          participant_id: string
          request_id: string
        }
        Update: {
          abandoned_at?: string
          participant_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abandoned_order_requests_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_memberships: {
        Row: {
          branch_id: string
          membership_id: string
          restaurant_id: string
        }
        Insert: {
          branch_id: string
          membership_id: string
          restaurant_id: string
        }
        Update: {
          branch_id?: string
          membership_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_memberships_branch_id_restaurant_id_fkey"
            columns: ["branch_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "branch_memberships_membership_id_restaurant_id_fkey"
            columns: ["membership_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_members"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          payment_methods: Database["public"]["Enums"]["payment_method"][]
          restaurant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          payment_methods?: Database["public"]["Enums"]["payment_method"][]
          restaurant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          payment_methods?: Database["public"]["Enums"]["payment_method"][]
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
      floor_sections: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "floor_sections_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_sections_restaurant_id_fkey"
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
            columns: ["restaurant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["restaurant_id", "id"]
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
            columns: ["restaurant_id", "group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["restaurant_id", "id"]
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
      order_status_transitions: {
        Row: {
          from_status: Database["public"]["Enums"]["order_status"]
          kind: Database["public"]["Enums"]["order_transition_kind"]
          permission: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["order_status"]
          kind: Database["public"]["Enums"]["order_transition_kind"]
          permission: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["order_status"]
          kind?: Database["public"]["Enums"]["order_transition_kind"]
          permission?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: []
      }
      orders: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          local_date: string | null
          notes: string | null
          origin: Database["public"]["Enums"]["order_origin"]
          preparing_at: string | null
          ready_at: string | null
          request_id: string | null
          request_payload: Json | null
          restaurant_id: string
          session_id: string
          staff_author_id: string | null
          staff_author_name: string | null
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
          local_date?: string | null
          notes?: string | null
          origin?: Database["public"]["Enums"]["order_origin"]
          preparing_at?: string | null
          ready_at?: string | null
          request_id?: string | null
          request_payload?: Json | null
          restaurant_id: string
          session_id: string
          staff_author_id?: string | null
          staff_author_name?: string | null
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
          local_date?: string | null
          notes?: string | null
          origin?: Database["public"]["Enums"]["order_origin"]
          preparing_at?: string | null
          ready_at?: string | null
          request_id?: string | null
          request_payload?: Json | null
          restaurant_id?: string
          session_id?: string
          staff_author_id?: string | null
          staff_author_name?: string | null
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
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "pos_open_sessions"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["restaurant_id", "session_id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "orders_staff_author_id_fkey"
            columns: ["staff_author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      payment_order_items: {
        Row: {
          amount: number
          order_item_id: string
          payment_id: string
        }
        Insert: {
          amount: number
          order_item_id: string
          payment_id: string
        }
        Update: {
          amount?: number
          order_item_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_order_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          external_reference: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          mode: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id: string | null
          participant_id: string | null
          provider_status: string | null
          provider_updated_at: string | null
          reconciliation_issue: string | null
          refunded_amount: number
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          external_reference?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          mode: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id?: string | null
          participant_id?: string | null
          provider_status?: string | null
          provider_updated_at?: string | null
          reconciliation_issue?: string | null
          refunded_amount?: number
          restaurant_id: string
          session_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          external_reference?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          mode?: Database["public"]["Enums"]["payment_mode"]
          mp_payment_id?: string | null
          participant_id?: string | null
          provider_status?: string | null
          provider_updated_at?: string | null
          reconciliation_issue?: string | null
          refunded_amount?: number
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
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "pos_open_sessions"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["restaurant_id", "session_id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["restaurant_id", "session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["restaurant_id", "id"]
          },
        ]
      }
      pos_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          branch_id: string | null
          created_at: string
          details: Json
          employee_id: string | null
          id: string
          order_id: string | null
          restaurant_id: string
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
          order_id?: string | null
          restaurant_id: string
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
          order_id?: string | null
          restaurant_id?: string
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "pos_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_audit_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_open_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_audit_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_bills"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "pos_audit_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_employees: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          migrated_user_id: string | null
          pin_hash: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          is_active?: boolean
          migrated_user_id?: string | null
          pin_hash: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          migrated_user_id?: string | null
          pin_hash?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_employees_migrated_user_id_fkey"
            columns: ["migrated_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_employees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
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
            columns: ["restaurant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["restaurant_id", "id"]
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
            columns: ["restaurant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["restaurant_id", "id"]
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
            columns: ["restaurant_id", "group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_id_fkey"
            columns: ["restaurant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["restaurant_id", "id"]
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
            columns: ["restaurant_id", "category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["restaurant_id", "id"]
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
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          updated_at: string
          username_normalized: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          updated_at?: string
          username_normalized: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
          username_normalized?: string
        }
        Relationships: []
      }
      restaurant_members: {
        Row: {
          additional_roles: Database["public"]["Enums"]["member_role"][]
          created_at: string
          id: string
          is_active: boolean
          restaurant_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          additional_roles?: Database["public"]["Enums"]["member_role"][]
          created_at?: string
          id?: string
          is_active?: boolean
          restaurant_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          additional_roles?: Database["public"]["Enums"]["member_role"][]
          created_at?: string
          id?: string
          is_active?: boolean
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
          menu_design: Database["public"]["Enums"]["menu_design"]
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          menu_design?: Database["public"]["Enums"]["menu_design"]
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          menu_design?: Database["public"]["Enums"]["menu_design"]
          name?: string
          slug?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["member_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["member_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["member_role"]
        }
        Relationships: []
      }
      session_participants: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          named_at: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          named_at?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          named_at?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_open_sessions"
            referencedColumns: ["id"]
          },
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
          assigned_employee_id: string | null
          assigned_user_id: string | null
          bill_attended_at: string | null
          bill_requested_at: string | null
          branch_id: string
          closed_at: string | null
          id: string
          in_person_payment_attended_at: string | null
          in_person_payment_requested_at: string | null
          kind: Database["public"]["Enums"]["session_kind"]
          opened_at: string
          restaurant_id: string
          split_allocations: Json
          split_equal_parts: number | null
          split_type: Database["public"]["Enums"]["split_type"]
          split_updated_at: string | null
          split_updated_by: string | null
          status: Database["public"]["Enums"]["session_status"]
          table_id: string | null
        }
        Insert: {
          assigned_employee_id?: string | null
          assigned_user_id?: string | null
          bill_attended_at?: string | null
          bill_requested_at?: string | null
          branch_id: string
          closed_at?: string | null
          id?: string
          in_person_payment_attended_at?: string | null
          in_person_payment_requested_at?: string | null
          kind?: Database["public"]["Enums"]["session_kind"]
          opened_at?: string
          restaurant_id: string
          split_allocations?: Json
          split_equal_parts?: number | null
          split_type?: Database["public"]["Enums"]["split_type"]
          split_updated_at?: string | null
          split_updated_by?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          table_id?: string | null
        }
        Update: {
          assigned_employee_id?: string | null
          assigned_user_id?: string | null
          bill_attended_at?: string | null
          bill_requested_at?: string | null
          branch_id?: string
          closed_at?: string | null
          id?: string
          in_person_payment_attended_at?: string | null
          in_person_payment_requested_at?: string | null
          kind?: Database["public"]["Enums"]["session_kind"]
          opened_at?: string
          restaurant_id?: string
          split_allocations?: Json
          split_equal_parts?: number | null
          split_type?: Database["public"]["Enums"]["split_type"]
          split_updated_at?: string | null
          split_updated_by?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "pos_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_branch_fkey"
            columns: ["restaurant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["restaurant_id", "branch_id", "table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["restaurant_id", "branch_id", "id"]
          },
        ]
      }
      tables: {
        Row: {
          branch_id: string
          created_at: string
          height: number
          id: string
          is_active: boolean
          is_visible: boolean
          label: string
          position_x: number
          position_y: number
          qr_token: string
          restaurant_id: string
          seats: number
          section_id: string | null
          shape: string
          width: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          height?: number
          id?: string
          is_active?: boolean
          is_visible?: boolean
          label: string
          position_x?: number
          position_y?: number
          qr_token?: string
          restaurant_id: string
          seats?: number
          section_id?: string | null
          shape?: string
          width?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          height?: number
          id?: string
          is_active?: boolean
          is_visible?: boolean
          label?: string
          position_x?: number
          position_y?: number
          qr_token?: string
          restaurant_id?: string
          seats?: number
          section_id?: string | null
          shape?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "tables_branch_id_fkey"
            columns: ["restaurant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_section_same_branch"
            columns: ["section_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "floor_sections"
            referencedColumns: ["id", "branch_id"]
          },
        ]
      }
    }
    Views: {
      pos_open_sessions: {
        Row: {
          assigned_employee_name: string | null
          bill_attended_at: string | null
          bill_requested_at: string | null
          branch_id: string | null
          branch_name: string | null
          has_pending_payment: boolean | null
          id: string | null
          in_person_payment_attended_at: string | null
          in_person_payment_requested_at: string | null
          kind: Database["public"]["Enums"]["session_kind"] | null
          kitchen_statuses: Database["public"]["Enums"]["order_status"][] | null
          kitchen_tickets: number | null
          opened_at: string | null
          paid_amount: number | null
          participant_names: string[] | null
          pending_amount: number | null
          restaurant_id: string | null
          submitted_amount: number | null
          table_id: string | null
          table_label: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_branch_fkey"
            columns: ["restaurant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["restaurant_id", "id"]
          },
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["restaurant_id", "branch_id", "table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["restaurant_id", "branch_id", "id"]
          },
        ]
      }
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
      abandon_order_request: {
        Args: { p_request_id: string; p_session_id: string }
        Returns: string
      }
      add_guest_participant: {
        Args: {
          p_display_name: string
          p_item_ids?: string[]
          p_session_id: string
        }
        Returns: string
      }
      apply_mercado_pago_payment: {
        Args: {
          p_amount: number
          p_currency_id: string
          p_external_reference: string
          p_payment_id: string
          p_provider_payment_id: string
          p_provider_status: string
          p_provider_updated_at: string
          p_refunded_amount?: number
        }
        Returns: {
          amount: number
          payment_id: string
          status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      audit_employee_password_reset: {
        Args: {
          p_actor: string
          p_completed?: boolean
          p_restaurant: string
          p_user: string
        }
        Returns: undefined
      }
      authorize_employee_change: {
        Args: {
          p_actor: string
          p_global?: boolean
          p_restaurant: string
          p_roles?: Database["public"]["Enums"]["member_role"][]
          p_user?: string
        }
        Returns: boolean
      }
      can_manage_media: { Args: { object_name: string }; Returns: boolean }
      can_read_coworker: { Args: { uid: string }; Returns: boolean }
      can_read_session: {
        Args: { permission_name?: string; sid: string }
        Returns: boolean
      }
      claim_mobile_checkout: {
        Args: { p_payment_id: string; p_user_id: string }
        Returns: {
          access_token: string
          amount: number
          branch_id: string
          checkout_state: string
          checkout_url: string
          collector_id: string
          currency_id: string
          environment: Database["public"]["Enums"]["payment_provider_environment"]
          external_reference: string
          lease_token: string
          mp_payment_id: string
          payment_id: string
          preference_id: string
          provider_status: string
          qr_token: string
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["payment_status"]
          webhook_secret: string
        }[]
      }
      close_table_session: { Args: { p_session_id: string }; Returns: string }
      complete_mobile_checkout: {
        Args: {
          p_checkout_url: string
          p_collector_id: string
          p_lease_token: string
          p_payment_id: string
          p_preference_id: string
        }
        Returns: undefined
      }
      consume_payment_rate_limit: {
        Args: { p_action: string; p_user_id: string }
        Returns: undefined
      }
      create_mobile_payment: {
        Args: {
          p_item_ids?: string[]
          p_mode?: Database["public"]["Enums"]["payment_mode"]
          p_request_id: string
          p_session_id: string
        }
        Returns: {
          amount: number
          payment_id: string
          status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      create_restaurant: {
        Args: {
          p_branch_name: string
          p_description?: string
          p_menu_design: Database["public"]["Enums"]["menu_design"]
          p_name: string
          p_slug: string
        }
        Returns: string
      }
      customer_dispatch_internal_order: {
        Args: { p_order_id: string }
        Returns: string
      }
      customer_join_table_session: {
        Args: { participant_name?: string; qr: string }
        Returns: string
      }
      delete_payment_provider_config: {
        Args: { p_restaurant_id: string }
        Returns: undefined
      }
      delete_pos_employee: {
        Args: { p_employee_id: string; p_restaurant_id: string }
        Returns: string
      }
      dispatch_internal_order: { Args: { p_order_id: string }; Returns: string }
      employee_catalog_access: {
        Args: { bid?: string; rid: string }
        Returns: boolean
      }
      employee_email_exists: { Args: { p_email: string }; Returns: boolean }
      fail_mobile_checkout: {
        Args: {
          p_definitive?: boolean
          p_lease_token: string
          p_payment_id: string
        }
        Returns: undefined
      }
      get_order_pos_type: {
        Args: { p_order_id: string }
        Returns: Database["public"]["Enums"]["pos_type"]
      }
      get_payment_provider_config: {
        Args: { p_restaurant_id: string }
        Returns: {
          access_token_hint: string
          branch_ids: string[]
          configured: boolean
          environment: Database["public"]["Enums"]["payment_provider_environment"]
          provider: Database["public"]["Enums"]["payment_provider"]
          updated_at: string
          webhook_configured: boolean
        }[]
      }
      get_pos_contexts: {
        Args: never
        Returns: {
          branch_id: string
          branch_name: string
          full_name: string
          permissions: string[]
          restaurant_id: string
          restaurant_name: string
        }[]
      }
      has_permission: {
        Args: { bid?: string; permission_name: string; rid: string }
        Returns: boolean
      }
      is_restaurant_admin: { Args: { rid: string }; Returns: boolean }
      is_restaurant_member: { Args: { rid: string }; Returns: boolean }
      is_session_participant: { Args: { sid: string }; Returns: boolean }
      join_table_session: {
        Args: { participant_name?: string; qr: string }
        Returns: string
      }
      list_employee_accounts: {
        Args: { p_restaurant: string }
        Returns: {
          branch_ids: string[]
          full_name: string
          is_active: boolean
          roles: Database["public"]["Enums"]["member_role"][]
          user_id: string
          username: string
        }[]
      }
      mobile_payment_available: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      pos_close_table_session: {
        Args: { p_session_id: string }
        Returns: string
      }
      pos_move_table_session: {
        Args: {
          p_destination_table_id: string
          p_session_id: string
          p_source_table_id: string
        }
        Returns: string
      }
      pos_open_table_session: { Args: { p_table_id: string }; Returns: string }
      pos_record_payment: {
        Args: {
          p_amount: number
          p_external_reference?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_participant_id?: string
          p_session_id: string
        }
        Returns: string
      }
      pos_resolve_session_request: {
        Args: {
          p_kind: Database["public"]["Enums"]["session_request_kind"]
          p_session_id: string
        }
        Returns: string
      }
      pos_transition_order: {
        Args: {
          p_order_id: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: string
      }
      record_pos_action: {
        Args: {
          p_action: string
          p_branch_id: string
          p_details?: Json
          p_order_id: string
          p_restaurant_id: string
          p_session_id: string
        }
        Returns: undefined
      }
      reorder_categories: {
        Args: { p_category_ids: string[]; p_restaurant_id: string }
        Returns: undefined
      }
      request_session_service: {
        Args: {
          p_kind: Database["public"]["Enums"]["session_request_kind"]
          p_session_id: string
        }
        Returns: string
      }
      resolve_mobile_payment: {
        Args: {
          p_payment_id: string
          p_status: Database["public"]["Enums"]["payment_status"]
          p_user_id: string
        }
        Returns: {
          amount: number
          payment_id: string
          status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      resolve_payment_provider_for_payment: {
        Args: { p_payment_id: string; p_user_id?: string }
        Returns: {
          access_token: string
          amount: number
          branch_id: string
          checkout_state: string
          checkout_url: string
          collector_id: string
          currency_id: string
          environment: Database["public"]["Enums"]["payment_provider_environment"]
          external_reference: string
          lease_token: string
          mp_payment_id: string
          payment_id: string
          preference_id: string
          provider_status: string
          qr_token: string
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["payment_status"]
          webhook_secret: string
        }[]
      }
      resolve_payment_provider_for_session: {
        Args: { p_session_id: string }
        Returns: {
          access_token: string
          branch_id: string
          environment: Database["public"]["Enums"]["payment_provider_environment"]
          provider: Database["public"]["Enums"]["payment_provider"]
          restaurant_id: string
          webhook_secret: string
        }[]
      }
      save_employee_account: {
        Args: {
          p_active: boolean
          p_actor: string
          p_branches: string[]
          p_full_name: string
          p_legacy?: string
          p_restaurant: string
          p_roles: Database["public"]["Enums"]["member_role"][]
          p_user: string
          p_username?: string
        }
        Returns: string
      }
      save_floor: {
        Args: { p_branch_id: string; p_changes: Json }
        Returns: undefined
      }
      save_modifier_group: {
        Args: {
          p_group_id?: string
          p_is_available: boolean
          p_max_select: number
          p_min_select: number
          p_name: string
          p_options: Json
          p_restaurant_id: string
        }
        Returns: string
      }
      save_payment_provider_config: {
        Args: {
          p_access_token?: string
          p_branch_ids: string[]
          p_environment: Database["public"]["Enums"]["payment_provider_environment"]
          p_restaurant_id: string
          p_webhook_secret?: string
        }
        Returns: undefined
      }
      save_product: {
        Args: {
          p_base_price: number
          p_category_id: string
          p_description?: string
          p_dietary_tags: string[]
          p_food_info?: string
          p_group_ids: string[]
          p_ingredients: Json
          p_is_available: boolean
          p_media_urls: string[]
          p_name: string
          p_product_id?: string
          p_restaurant_id: string
        }
        Returns: string
      }
      session_percentage_share: {
        Args: { p_participant_id: string; p_session_id: string }
        Returns: number
      }
      submit_order: {
        Args: {
          p_expected_total: number
          p_items: Json
          p_notes?: string
          p_request_id: string
          p_session_id: string
        }
        Returns: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          local_date: string | null
          notes: string | null
          origin: Database["public"]["Enums"]["order_origin"]
          preparing_at: string | null
          ready_at: string | null
          request_id: string | null
          request_payload: Json | null
          restaurant_id: string
          session_id: string
          staff_author_id: string | null
          staff_author_name: string | null
          status: Database["public"]["Enums"]["order_status"]
          submitted_by: string | null
          total_amount: number
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_order: {
        Args: {
          p_order_id: string
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: string
      }
      update_session_split: {
        Args: {
          p_allocations?: Json
          p_equal_parts?: number
          p_session_id: string
          p_split_type: Database["public"]["Enums"]["split_type"]
        }
        Returns: undefined
      }
      upsert_pos_employee: {
        Args: {
          p_employee_id?: string
          p_full_name: string
          p_is_active?: boolean
          p_pin?: string
          p_restaurant_id: string
        }
        Returns: string
      }
      verify_pos_pin: {
        Args: { p_pin: string; p_restaurant_id: string }
        Returns: {
          full_name: string
          id: string
        }[]
      }
    }
    Enums: {
      member_role:
        | "owner"
        | "staff"
        | "manager"
        | "supervisor"
        | "waiter"
        | "cashier"
        | "kitchen"
      menu_design: "oliva" | "brasas" | "linterna"
      order_origin: "qr" | "pos"
      order_status:
        | "submitted"
        | "accepted"
        | "in_preparation"
        | "ready"
        | "delivered"
        | "cancelled"
      order_transition_kind: "advance" | "revert" | "cancel"
      payment_method: "mobile" | "in_person" | "external"
      payment_mode:
        | "full"
        | "own"
        | "equal_split"
        | "custom"
        | "percentage_split"
      payment_provider: "mercado_pago"
      payment_provider_environment: "test" | "production"
      payment_status: "pending" | "approved" | "rejected" | "cancelled"
      pos_type: "internal" | "fudo"
      session_kind: "table" | "takeout"
      session_request_kind: "bill" | "in_person_payment"
      session_status: "open" | "closed"
      split_type: "none" | "equal" | "percentages"
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
      member_role: [
        "owner",
        "staff",
        "manager",
        "supervisor",
        "waiter",
        "cashier",
        "kitchen",
      ],
      menu_design: ["oliva", "brasas", "linterna"],
      order_origin: ["qr", "pos"],
      order_status: [
        "submitted",
        "accepted",
        "in_preparation",
        "ready",
        "delivered",
        "cancelled",
      ],
      order_transition_kind: ["advance", "revert", "cancel"],
      payment_method: ["mobile", "in_person", "external"],
      payment_mode: [
        "full",
        "own",
        "equal_split",
        "custom",
        "percentage_split",
      ],
      payment_provider: ["mercado_pago"],
      payment_provider_environment: ["test", "production"],
      payment_status: ["pending", "approved", "rejected", "cancelled"],
      pos_type: ["internal", "fudo"],
      session_kind: ["table", "takeout"],
      session_request_kind: ["bill", "in_person_payment"],
      session_status: ["open", "closed"],
      split_type: ["none", "equal", "percentages"],
    },
  },
} as const

