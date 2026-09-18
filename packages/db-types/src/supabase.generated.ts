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
      ai_usage: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          context_type: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          input_tokens: number
          matter_id: string | null
          model: string
          output_tokens: number
          route: string
          success: boolean
          user_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          context_type?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_tokens?: number
          matter_id?: string | null
          model: string
          output_tokens?: number
          route: string
          success?: boolean
          user_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          context_type?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_tokens?: number
          matter_id?: string | null
          model?: string
          output_tokens?: number
          route?: string
          success?: boolean
          user_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "ai_usage_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "ai_usage_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_types: {
        Row: {
          active: boolean
          created_at: string
          custom_weekly_hours: Json | null
          description: string
          duration_minutes: number
          id: string
          key: string
          label: string
          location_type: string
          location_types: string[]
          public: boolean
          slug: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          custom_weekly_hours?: Json | null
          description?: string
          duration_minutes?: number
          id?: string
          key: string
          label: string
          location_type?: string
          location_types?: string[]
          public?: boolean
          slug: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          custom_weekly_hours?: Json | null
          description?: string
          duration_minutes?: number
          id?: string
          key?: string
          label?: string
          location_type?: string
          location_types?: string[]
          public?: boolean
          slug?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          appointment_type_id: string
          attendee_email: string
          attendee_first_name: string | null
          attendee_last_name: string | null
          attendee_name: string
          attendee_phone: string | null
          booked_by_user_id: string | null
          created_at: string
          end_time: string
          external_booking_uid: string | null
          google_event_id: string | null
          id: string
          linked_lead_id: string | null
          linked_matter_id: string | null
          location_type: string | null
          manage_token_expires_at: string | null
          manage_token_hash: string | null
          microsoft_event_id: string | null
          notes: string | null
          online_meeting_url: string | null
          raw: Json
          reminder_sent_at: string | null
          second_attendee_email: string | null
          second_attendee_first_name: string | null
          second_attendee_last_name: string | null
          second_attendee_name: string | null
          source: string
          start_time: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_type_id: string
          attendee_email: string
          attendee_first_name?: string | null
          attendee_last_name?: string | null
          attendee_name: string
          attendee_phone?: string | null
          booked_by_user_id?: string | null
          created_at?: string
          end_time: string
          external_booking_uid?: string | null
          google_event_id?: string | null
          id?: string
          linked_lead_id?: string | null
          linked_matter_id?: string | null
          location_type?: string | null
          manage_token_expires_at?: string | null
          manage_token_hash?: string | null
          microsoft_event_id?: string | null
          notes?: string | null
          online_meeting_url?: string | null
          raw?: Json
          reminder_sent_at?: string | null
          second_attendee_email?: string | null
          second_attendee_first_name?: string | null
          second_attendee_last_name?: string | null
          second_attendee_name?: string | null
          source?: string
          start_time: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_type_id?: string
          attendee_email?: string
          attendee_first_name?: string | null
          attendee_last_name?: string | null
          attendee_name?: string
          attendee_phone?: string | null
          booked_by_user_id?: string | null
          created_at?: string
          end_time?: string
          external_booking_uid?: string | null
          google_event_id?: string | null
          id?: string
          linked_lead_id?: string | null
          linked_matter_id?: string | null
          location_type?: string | null
          manage_token_expires_at?: string | null
          manage_token_hash?: string | null
          microsoft_event_id?: string | null
          notes?: string | null
          online_meeting_url?: string | null
          raw?: Json
          reminder_sent_at?: string | null
          second_attendee_email?: string | null
          second_attendee_first_name?: string | null
          second_attendee_last_name?: string | null
          second_attendee_name?: string | null
          source?: string
          start_time?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "appointments_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      asset_funding: {
        Row: {
          asset_intake_id: string
          confirmed_on: string | null
          created_at: string
          id: string
          matter_id: string
          method: string
          note: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_intake_id: string
          confirmed_on?: string | null
          created_at?: string
          id?: string
          matter_id: string
          method?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_intake_id?: string
          confirmed_on?: string | null
          created_at?: string
          id?: string
          matter_id?: string
          method?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_funding_asset_intake_id_fkey"
            columns: ["asset_intake_id"]
            isOneToOne: false
            referencedRelation: "asset_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_funding_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_funding_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "asset_funding_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "asset_funding_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_intake: {
        Row: {
          category: string
          client_intake_id: string
          created_at: string
          description: string
          details: Json
          id: string
          ownership: string
          updated_at: string
          value: number
        }
        Insert: {
          category: string
          client_intake_id: string
          created_at?: string
          description?: string
          details?: Json
          id?: string
          ownership?: string
          updated_at?: string
          value?: number
        }
        Update: {
          category?: string
          client_intake_id?: string
          created_at?: string
          description?: string
          details?: Json
          id?: string
          ownership?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_intake_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_intake_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          events: Json
          id: string
          role: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          events?: Json
          id?: string
          role: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          events?: Json
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "assistant_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_chats: {
        Row: {
          context_id: string | null
          context_type: string
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_adjustments: {
        Row: {
          amount_cents: number
          balance_effect: string
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          invoice_id: string
          kind: string
          metadata: Json
          payment_group_id: string | null
          provider: string | null
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          balance_effect: string
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          invoice_id: string
          kind: string
          metadata?: Json
          payment_group_id?: string | null
          provider?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          balance_effect?: string
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          invoice_id?: string
          kind?: string
          metadata?: Json
          payment_group_id?: string | null
          provider?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          actor_id: string | null
          billing_item_id: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: string
          invoice_id: string | null
          metadata: Json
        }
        Insert: {
          actor_id?: string | null
          billing_item_id?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          invoice_id?: string | null
          metadata?: Json
        }
        Update: {
          actor_id?: string | null
          billing_item_id?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          invoice_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_billing_item_id_fkey"
            columns: ["billing_item_id"]
            isOneToOne: false
            referencedRelation: "billing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_item_deletions: {
        Row: {
          amount_billed: number
          amount_collected: number
          billing_item_id: string
          deleted_at: string
          deleted_by: string | null
          id: string
          item_created_at: string
          kind: string
          label: string
          matter_id: string
          payments_deleted: number
          plan: string | null
          source: string
          status: string
        }
        Insert: {
          amount_billed: number
          amount_collected?: number
          billing_item_id: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          item_created_at: string
          kind: string
          label: string
          matter_id: string
          payments_deleted?: number
          plan?: string | null
          source: string
          status: string
        }
        Update: {
          amount_billed?: number
          amount_collected?: number
          billing_item_id?: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          item_created_at?: string
          kind?: string
          label?: string
          matter_id?: string
          payments_deleted?: number
          plan?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_item_deletions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_item_deletions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "billing_item_deletions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      billing_items: {
        Row: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_billed: number
          created_at?: string
          created_by?: string | null
          id?: string
          incurred_at?: string | null
          invoice_id?: string | null
          invoiced_at?: string | null
          kind: string
          label: string
          last_reminded_at?: string | null
          matter_id: string
          plan?: string | null
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_billed?: number
          created_at?: string
          created_by?: string | null
          id?: string
          incurred_at?: string | null
          invoice_id?: string | null
          invoiced_at?: string | null
          kind?: string
          label?: string
          last_reminded_at?: string | null
          matter_id?: string
          plan?: string | null
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_items_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_items_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "billing_items_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      billing_nudge_dismissals: {
        Row: {
          created_at: string
          nudge_key: string
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          nudge_key: string
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          nudge_key?: string
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      billing_payments: {
        Row: {
          amount: number
          billing_item_id: string
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          invoice_id: string | null
          method: string
          note: string | null
          payment_group_id: string
          processor_fee_cents: number
          received_at: string
        }
        Insert: {
          amount: number
          billing_item_id: string
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          invoice_id?: string | null
          method: string
          note?: string | null
          payment_group_id?: string
          processor_fee_cents?: number
          received_at?: string
        }
        Update: {
          amount?: number
          billing_item_id?: string
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          invoice_id?: string | null
          method?: string
          note?: string | null
          payment_group_id?: string
          processor_fee_cents?: number
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_payments_billing_item_id_fkey"
            columns: ["billing_item_id"]
            isOneToOne: false
            referencedRelation: "billing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      box_document_exports: {
        Row: {
          attempts: number
          box_file_id: string | null
          box_file_name: string | null
          box_folder_id: string | null
          completed_at: string | null
          created_at: string
          document_id: string
          id: string
          last_error: string | null
          matter_id: string
          next_attempt_at: string
          processing_started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          box_file_id?: string | null
          box_file_name?: string | null
          box_folder_id?: string | null
          completed_at?: string | null
          created_at?: string
          document_id: string
          id?: string
          last_error?: string | null
          matter_id: string
          next_attempt_at?: string
          processing_started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          box_file_id?: string | null
          box_file_name?: string | null
          box_folder_id?: string | null
          completed_at?: string | null
          created_at?: string
          document_id?: string
          id?: string
          last_error?: string | null
          matter_id?: string
          next_attempt_at?: string
          processing_started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_document_exports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      box_matter_folders: {
        Row: {
          box_folder_id: string
          created_at: string
          folder_name: string
          matter_id: string
          updated_at: string
        }
        Insert: {
          box_folder_id: string
          created_at?: string
          folder_name: string
          matter_id: string
          updated_at?: string
        }
        Update: {
          box_folder_id?: string
          created_at?: string
          folder_name?: string
          matter_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      calendar_attention_dismissals: {
        Row: {
          calendar_date: string
          created_at: string
          item_id: string
          user_id: string
        }
        Insert: {
          calendar_date: string
          created_at?: string
          item_id: string
          user_id: string
        }
        Update: {
          calendar_date?: string
          created_at?: string
          item_id?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_connections: {
        Row: {
          access_token: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          provider: string
          refresh_token: string | null
          scopes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          provider?: string
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          provider?: string
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          answered_at: string | null
          assigned_at: string | null
          assigned_by: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          external_call_id: string
          firm_user_email: string | null
          firm_user_id: string | null
          from_number: string | null
          id: string
          participant_digits: string | null
          participant_number: string
          provider: string
          raw_payload: Json
          recording_url: string | null
          started_at: string
          status: string
          summary: string | null
          to_number: string | null
          transcript: string | null
          triage_dismissed_at: string | null
          triage_dismissed_by: string | null
          updated_at: string
          voicemail_url: string | null
        }
        Insert: {
          answered_at?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          external_call_id: string
          firm_user_email?: string | null
          firm_user_id?: string | null
          from_number?: string | null
          id?: string
          participant_digits?: string | null
          participant_number: string
          provider?: string
          raw_payload?: Json
          recording_url?: string | null
          started_at?: string
          status: string
          summary?: string | null
          to_number?: string | null
          transcript?: string | null
          triage_dismissed_at?: string | null
          triage_dismissed_by?: string | null
          updated_at?: string
          voicemail_url?: string | null
        }
        Update: {
          answered_at?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          external_call_id?: string
          firm_user_email?: string | null
          firm_user_id?: string | null
          from_number?: string | null
          id?: string
          participant_digits?: string | null
          participant_number?: string
          provider?: string
          raw_payload?: Json
          recording_url?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          to_number?: string | null
          transcript?: string | null
          triage_dismissed_at?: string | null
          triage_dismissed_by?: string | null
          updated_at?: string
          voicemail_url?: string | null
        }
        Relationships: []
      }
      ceremony_documents: {
        Row: {
          ceremony_id: string
          created_at: string
          document_kind: string
          executed: boolean
          id: string
          notarized: boolean
          note: string | null
          recorded_on: string | null
          recording_reference: string | null
          signed_on: string | null
          updated_at: string
          witness_count: number
        }
        Insert: {
          ceremony_id: string
          created_at?: string
          document_kind: string
          executed?: boolean
          id?: string
          notarized?: boolean
          note?: string | null
          recorded_on?: string | null
          recording_reference?: string | null
          signed_on?: string | null
          updated_at?: string
          witness_count?: number
        }
        Update: {
          ceremony_id?: string
          created_at?: string
          document_kind?: string
          executed?: boolean
          id?: string
          notarized?: boolean
          note?: string | null
          recorded_on?: string | null
          recording_reference?: string | null
          signed_on?: string | null
          updated_at?: string
          witness_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ceremony_documents_ceremony_id_fkey"
            columns: ["ceremony_id"]
            isOneToOne: false
            referencedRelation: "signing_ceremonies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_intake: {
        Row: {
          additional_contacts: Json | null
          additional_emails: Json
          additional_phones: Json
          address_line1: string | null
          address_line2: string | null
          attorney_review_flags: Json
          billing_type: string | null
          citizenship: string | null
          citizenship_status: string | null
          city: string | null
          client_user_id: string | null
          college_prep_details: Json | null
          county: string | null
          created_at: string
          current_step: string | null
          date_of_birth: string | null
          date_of_marriage: string | null
          document_inclusions: Json | null
          email: string | null
          employer: string | null
          engagement_envelope_id: string | null
          engagement_fee_quoted: number | null
          engagement_provider: string | null
          engagement_sent_at: string | null
          engagement_signed_at: string | null
          engagement_status: string | null
          estate_value: string | null
          excluded_guardian: string | null
          excluded_guardian_2: string | null
          family_details: Json | null
          fiduciary_entries: Json | null
          financial_details: Json | null
          first_name: string | null
          full_name: string | null
          goals: Json | null
          has_business: boolean | null
          has_children: boolean | null
          has_divorce_settlement: boolean | null
          has_existing_plan: boolean | null
          has_family_disability: boolean | null
          has_hcp: boolean | null
          has_investments: boolean | null
          has_life_insurance: boolean | null
          has_ltc_insurance: boolean | null
          has_major_illness: boolean | null
          has_minor_children: boolean | null
          has_poa: boolean | null
          has_prior_gift_tax: boolean | null
          has_real_property: boolean | null
          has_retirement: boolean | null
          has_trust: boolean | null
          has_will: boolean | null
          id: string
          intake_completed_at: string | null
          intake_invite_token: string | null
          intake_link_created_at: string | null
          intake_link_revoked_at: string | null
          intake_link_version: string | null
          intake_sent_at: string | null
          intake_token_expires_at: string | null
          intake_token_hash: string | null
          intake_token_last_used_at: string | null
          intake_track: string
          is_trust_beneficiary: boolean | null
          is_us_citizen: boolean | null
          last_name: string | null
          lawmatics_matter_id: string | null
          lead_next_action_snoozed_until: string | null
          lead_source: string | null
          lead_status: string | null
          lead_urgency: string | null
          legal_plan_member_id: string | null
          legal_plan_service_end: string | null
          legal_plan_service_start: string | null
          marital_status: string | null
          marriage_date: string | null
          matter_id: string | null
          middle_name: string | null
          notes: string | null
          occupation: string | null
          other_individuals: Json | null
          phone: string | null
          plan_type: string | null
          planning_goals: string[] | null
          planning_objectives: string | null
          practice_area: string | null
          preferred_name: string | null
          preferred_pronoun: string | null
          prior_marriage: boolean | null
          prior_names: string | null
          probate_details: Json | null
          qualification_notes: string | null
          referral_source: string | null
          review_choices: Json | null
          special_circumstances: string[] | null
          special_notes: string | null
          spouse_as_fiduciary: boolean | null
          state: string | null
          status: string
          suffix: string | null
          taxable_estate: number | null
          unlock_request_note: string | null
          unlock_requested_at: string | null
          updated_at: string
          uploads_reviewed_at: string | null
          user_id: string | null
          zip: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_emails?: Json
          additional_phones?: Json
          address_line1?: string | null
          address_line2?: string | null
          attorney_review_flags?: Json
          billing_type?: string | null
          citizenship?: string | null
          citizenship_status?: string | null
          city?: string | null
          client_user_id?: string | null
          college_prep_details?: Json | null
          county?: string | null
          created_at?: string
          current_step?: string | null
          date_of_birth?: string | null
          date_of_marriage?: string | null
          document_inclusions?: Json | null
          email?: string | null
          employer?: string | null
          engagement_envelope_id?: string | null
          engagement_fee_quoted?: number | null
          engagement_provider?: string | null
          engagement_sent_at?: string | null
          engagement_signed_at?: string | null
          engagement_status?: string | null
          estate_value?: string | null
          excluded_guardian?: string | null
          excluded_guardian_2?: string | null
          family_details?: Json | null
          fiduciary_entries?: Json | null
          financial_details?: Json | null
          first_name?: string | null
          full_name?: string | null
          goals?: Json | null
          has_business?: boolean | null
          has_children?: boolean | null
          has_divorce_settlement?: boolean | null
          has_existing_plan?: boolean | null
          has_family_disability?: boolean | null
          has_hcp?: boolean | null
          has_investments?: boolean | null
          has_life_insurance?: boolean | null
          has_ltc_insurance?: boolean | null
          has_major_illness?: boolean | null
          has_minor_children?: boolean | null
          has_poa?: boolean | null
          has_prior_gift_tax?: boolean | null
          has_real_property?: boolean | null
          has_retirement?: boolean | null
          has_trust?: boolean | null
          has_will?: boolean | null
          id?: string
          intake_completed_at?: string | null
          intake_invite_token?: string | null
          intake_link_created_at?: string | null
          intake_link_revoked_at?: string | null
          intake_link_version?: string | null
          intake_sent_at?: string | null
          intake_token_expires_at?: string | null
          intake_token_hash?: string | null
          intake_token_last_used_at?: string | null
          intake_track?: string
          is_trust_beneficiary?: boolean | null
          is_us_citizen?: boolean | null
          last_name?: string | null
          lawmatics_matter_id?: string | null
          lead_next_action_snoozed_until?: string | null
          lead_source?: string | null
          lead_status?: string | null
          lead_urgency?: string | null
          legal_plan_member_id?: string | null
          legal_plan_service_end?: string | null
          legal_plan_service_start?: string | null
          marital_status?: string | null
          marriage_date?: string | null
          matter_id?: string | null
          middle_name?: string | null
          notes?: string | null
          occupation?: string | null
          other_individuals?: Json | null
          phone?: string | null
          plan_type?: string | null
          planning_goals?: string[] | null
          planning_objectives?: string | null
          practice_area?: string | null
          preferred_name?: string | null
          preferred_pronoun?: string | null
          prior_marriage?: boolean | null
          prior_names?: string | null
          probate_details?: Json | null
          qualification_notes?: string | null
          referral_source?: string | null
          review_choices?: Json | null
          special_circumstances?: string[] | null
          special_notes?: string | null
          spouse_as_fiduciary?: boolean | null
          state?: string | null
          status?: string
          suffix?: string | null
          taxable_estate?: number | null
          unlock_request_note?: string | null
          unlock_requested_at?: string | null
          updated_at?: string
          uploads_reviewed_at?: string | null
          user_id?: string | null
          zip?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_emails?: Json
          additional_phones?: Json
          address_line1?: string | null
          address_line2?: string | null
          attorney_review_flags?: Json
          billing_type?: string | null
          citizenship?: string | null
          citizenship_status?: string | null
          city?: string | null
          client_user_id?: string | null
          college_prep_details?: Json | null
          county?: string | null
          created_at?: string
          current_step?: string | null
          date_of_birth?: string | null
          date_of_marriage?: string | null
          document_inclusions?: Json | null
          email?: string | null
          employer?: string | null
          engagement_envelope_id?: string | null
          engagement_fee_quoted?: number | null
          engagement_provider?: string | null
          engagement_sent_at?: string | null
          engagement_signed_at?: string | null
          engagement_status?: string | null
          estate_value?: string | null
          excluded_guardian?: string | null
          excluded_guardian_2?: string | null
          family_details?: Json | null
          fiduciary_entries?: Json | null
          financial_details?: Json | null
          first_name?: string | null
          full_name?: string | null
          goals?: Json | null
          has_business?: boolean | null
          has_children?: boolean | null
          has_divorce_settlement?: boolean | null
          has_existing_plan?: boolean | null
          has_family_disability?: boolean | null
          has_hcp?: boolean | null
          has_investments?: boolean | null
          has_life_insurance?: boolean | null
          has_ltc_insurance?: boolean | null
          has_major_illness?: boolean | null
          has_minor_children?: boolean | null
          has_poa?: boolean | null
          has_prior_gift_tax?: boolean | null
          has_real_property?: boolean | null
          has_retirement?: boolean | null
          has_trust?: boolean | null
          has_will?: boolean | null
          id?: string
          intake_completed_at?: string | null
          intake_invite_token?: string | null
          intake_link_created_at?: string | null
          intake_link_revoked_at?: string | null
          intake_link_version?: string | null
          intake_sent_at?: string | null
          intake_token_expires_at?: string | null
          intake_token_hash?: string | null
          intake_token_last_used_at?: string | null
          intake_track?: string
          is_trust_beneficiary?: boolean | null
          is_us_citizen?: boolean | null
          last_name?: string | null
          lawmatics_matter_id?: string | null
          lead_next_action_snoozed_until?: string | null
          lead_source?: string | null
          lead_status?: string | null
          lead_urgency?: string | null
          legal_plan_member_id?: string | null
          legal_plan_service_end?: string | null
          legal_plan_service_start?: string | null
          marital_status?: string | null
          marriage_date?: string | null
          matter_id?: string | null
          middle_name?: string | null
          notes?: string | null
          occupation?: string | null
          other_individuals?: Json | null
          phone?: string | null
          plan_type?: string | null
          planning_goals?: string[] | null
          planning_objectives?: string | null
          practice_area?: string | null
          preferred_name?: string | null
          preferred_pronoun?: string | null
          prior_marriage?: boolean | null
          prior_names?: string | null
          probate_details?: Json | null
          qualification_notes?: string | null
          referral_source?: string | null
          review_choices?: Json | null
          special_circumstances?: string[] | null
          special_notes?: string | null
          spouse_as_fiduciary?: boolean | null
          state?: string | null
          status?: string
          suffix?: string | null
          taxable_estate?: number | null
          unlock_request_note?: string | null
          unlock_requested_at?: string | null
          updated_at?: string
          uploads_reviewed_at?: string | null
          user_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      communication_thread_state: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          marked_unread_at: string | null
          snoozed_until: string | null
          thread_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          marked_unread_at?: string | null
          snoozed_until?: string | null
          thread_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          marked_unread_at?: string | null
          snoozed_until?: string | null
          thread_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      contact_merges: {
        Row: {
          created_at: string
          design_sheets_rewritten: number
          id: string
          loser_contact_id: string
          loser_email: string | null
          loser_first_name: string | null
          loser_last_name: string | null
          matter_links_moved: number
          merged_by: string | null
          messages_moved: number
          reason: string | null
          roles_moved: number
          winner_contact_id: string
        }
        Insert: {
          created_at?: string
          design_sheets_rewritten?: number
          id?: string
          loser_contact_id: string
          loser_email?: string | null
          loser_first_name?: string | null
          loser_last_name?: string | null
          matter_links_moved?: number
          merged_by?: string | null
          messages_moved?: number
          reason?: string | null
          roles_moved?: number
          winner_contact_id: string
        }
        Update: {
          created_at?: string
          design_sheets_rewritten?: number
          id?: string
          loser_contact_id?: string
          loser_email?: string | null
          loser_first_name?: string | null
          loser_last_name?: string | null
          matter_links_moved?: number
          merged_by?: string | null
          messages_moved?: number
          reason?: string | null
          roles_moved?: number
          winner_contact_id?: string
        }
        Relationships: []
      }
      contact_roles: {
        Row: {
          client_intake_id: string | null
          contact_id: string
          created_at: string
          for_party: string
          id: string
          is_coagent: boolean
          matter_id: string | null
          priority: number
          role: string
        }
        Insert: {
          client_intake_id?: string | null
          contact_id: string
          created_at?: string
          for_party?: string
          id?: string
          is_coagent?: boolean
          matter_id?: string | null
          priority?: number
          role: string
        }
        Update: {
          client_intake_id?: string | null
          contact_id?: string
          created_at?: string
          for_party?: string
          id?: string
          is_coagent?: boolean
          matter_id?: string | null
          priority?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_roles_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_roles_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "contact_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "contact_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_roles_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_roles_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "contact_roles_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      contacts: {
        Row: {
          additional_emails: Json
          additional_phones: Json
          address_line1: string | null
          address_line2: string | null
          child_relationship: string | null
          citizenship_status: string | null
          city: string | null
          client_intake_id: string | null
          county: string | null
          created_at: string
          created_by_client_at: string | null
          date_of_birth: string | null
          deceased: boolean | null
          email: string | null
          first_name: string | null
          from_prior_relationship: boolean | null
          gender: string | null
          id: string
          is_minor: boolean | null
          is_us_citizen: boolean | null
          last_name: string | null
          lawmatics_contact_id: string | null
          merged_at: string | null
          merged_into_id: string | null
          middle_name: string | null
          parentage: string | null
          phone: string | null
          preferred_name: string | null
          preferred_pronoun: string | null
          prior_names: string | null
          relationship_label: string | null
          relationship_type: string
          source: string | null
          state: string | null
          suffix: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          additional_emails?: Json
          additional_phones?: Json
          address_line1?: string | null
          address_line2?: string | null
          child_relationship?: string | null
          citizenship_status?: string | null
          city?: string | null
          client_intake_id?: string | null
          county?: string | null
          created_at?: string
          created_by_client_at?: string | null
          date_of_birth?: string | null
          deceased?: boolean | null
          email?: string | null
          first_name?: string | null
          from_prior_relationship?: boolean | null
          gender?: string | null
          id?: string
          is_minor?: boolean | null
          is_us_citizen?: boolean | null
          last_name?: string | null
          lawmatics_contact_id?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          middle_name?: string | null
          parentage?: string | null
          phone?: string | null
          preferred_name?: string | null
          preferred_pronoun?: string | null
          prior_names?: string | null
          relationship_label?: string | null
          relationship_type: string
          source?: string | null
          state?: string | null
          suffix?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          additional_emails?: Json
          additional_phones?: Json
          address_line1?: string | null
          address_line2?: string | null
          child_relationship?: string | null
          citizenship_status?: string | null
          city?: string | null
          client_intake_id?: string | null
          county?: string | null
          created_at?: string
          created_by_client_at?: string | null
          date_of_birth?: string | null
          deceased?: boolean | null
          email?: string | null
          first_name?: string | null
          from_prior_relationship?: boolean | null
          gender?: string | null
          id?: string
          is_minor?: boolean | null
          is_us_citizen?: boolean | null
          last_name?: string | null
          lawmatics_contact_id?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          middle_name?: string | null
          parentage?: string | null
          phone?: string | null
          preferred_name?: string | null
          preferred_pronoun?: string | null
          prior_names?: string | null
          relationship_label?: string | null
          relationship_type?: string
          source?: string | null
          state?: string | null
          suffix?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_activities: {
        Row: {
          body: string | null
          channel: string | null
          completed_at: string | null
          created_at: string
          direction: string
          due_at: string | null
          event_type: string | null
          external_event_id: string | null
          id: string
          metadata: Json
          performed_by_user_id: string | null
          person_id: string
          source: string
          source_id: string | null
          source_type: string | null
          status: string
          subject: string | null
          type: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          direction?: string
          due_at?: string | null
          event_type?: string | null
          external_event_id?: string | null
          id?: string
          metadata?: Json
          performed_by_user_id?: string | null
          person_id: string
          source?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          subject?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          direction?: string
          due_at?: string | null
          event_type?: string | null
          external_event_id?: string | null
          id?: string
          metadata?: Json
          performed_by_user_id?: string | null
          person_id?: string
          source?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          subject?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_activities_performed_by_user_id_fkey"
            columns: ["performed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_activities_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_activities_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_cornerstone_crm_people"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaign_deliveries: {
        Row: {
          attempt_count: number
          campaign_id: string
          campaign_recipient_id: string
          created_at: string
          delivery_token: string
          delivery_token_hash: string
          error_code: string | null
          id: string
          last_event_at: string | null
          provider_message_id: string | null
          provider_status: string
          scheduled_at: string
          step_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          campaign_id: string
          campaign_recipient_id: string
          created_at?: string
          delivery_token: string
          delivery_token_hash: string
          error_code?: string | null
          id?: string
          last_event_at?: string | null
          provider_message_id?: string | null
          provider_status?: string
          scheduled_at?: string
          step_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          campaign_id?: string
          campaign_recipient_id?: string
          created_at?: string
          delivery_token?: string
          delivery_token_hash?: string
          error_code?: string | null
          id?: string
          last_event_at?: string | null
          provider_message_id?: string | null
          provider_status?: string
          scheduled_at?: string
          step_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaign_deliveries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_campaign_deliveries_campaign_recipient_id_fkey"
            columns: ["campaign_recipient_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaign_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_campaign_deliveries_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaign_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaign_dispatches: {
        Row: {
          accepted_count: number
          attempted_count: number
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          failed_count: number
          id: string
          provider_message_id: string | null
          status: string
        }
        Insert: {
          accepted_count?: number
          attempted_count?: number
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          provider_message_id?: string | null
          status?: string
        }
        Update: {
          accepted_count?: number
          attempted_count?: number
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          provider_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaign_dispatches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaign_events: {
        Row: {
          delivery_id: string | null
          event_type: string
          id: string
          payload: Json
          provider_event_id: string
          received_at: string
        }
        Insert: {
          delivery_id?: string | null
          event_type: string
          id?: string
          payload: Json
          provider_event_id: string
          received_at?: string
        }
        Update: {
          delivery_id?: string | null
          event_type?: string
          id?: string
          payload?: Json
          provider_event_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaign_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaign_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          error_code: string | null
          external_url: string | null
          id: string
          last_event_at: string | null
          person_id: string
          provider_message_id: string | null
          provider_status: string
          snapshot_email: string | null
          snapshot_first_name: string | null
          snapshot_last_name: string | null
          snapshot_marketing_status: string
          snapshot_person: Json
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_code?: string | null
          external_url?: string | null
          id?: string
          last_event_at?: string | null
          person_id: string
          provider_message_id?: string | null
          provider_status?: string
          snapshot_email?: string | null
          snapshot_first_name?: string | null
          snapshot_last_name?: string | null
          snapshot_marketing_status?: string
          snapshot_person?: Json
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_code?: string | null
          external_url?: string | null
          id?: string
          last_event_at?: string | null
          person_id?: string
          provider_message_id?: string | null
          provider_status?: string
          snapshot_email?: string | null
          snapshot_first_name?: string | null
          snapshot_last_name?: string | null
          snapshot_marketing_status?: string
          snapshot_person?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_campaign_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_campaign_recipients_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_cornerstone_crm_people"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaign_steps: {
        Row: {
          body_html: string
          body_text: string
          campaign_id: string
          created_at: string
          delay_days: number
          id: string
          is_active: boolean
          step_order: number
          subject: string
          updated_at: string
        }
        Insert: {
          body_html: string
          body_text: string
          campaign_id: string
          created_at?: string
          delay_days?: number
          id?: string
          is_active?: boolean
          step_order: number
          subject: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          body_text?: string
          campaign_id?: string
          created_at?: string
          delay_days?: number
          id?: string
          is_active?: boolean
          step_order?: number
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_campaigns: {
        Row: {
          audience_rules: Json
          body_html: string | null
          body_text: string | null
          created_at: string
          created_by_user_id: string
          email_provider: string
          id: string
          name: string
          provider_template_id: string | null
          send_schedule_cron_or_date: string | null
          status: string
          subject: string | null
          twenty_view_filter: Json | null
          type: string
          updated_at: string
        }
        Insert: {
          audience_rules?: Json
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          created_by_user_id: string
          email_provider?: string
          id?: string
          name: string
          provider_template_id?: string | null
          send_schedule_cron_or_date?: string | null
          status?: string
          subject?: string | null
          twenty_view_filter?: Json | null
          type: string
          updated_at?: string
        }
        Update: {
          audience_rules?: Json
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          created_by_user_id?: string
          email_provider?: string
          id?: string
          name?: string
          provider_template_id?: string | null
          send_schedule_cron_or_date?: string | null
          status?: string
          subject?: string | null
          twenty_view_filter?: Json | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_campaigns_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_people: {
        Row: {
          assigned_to_user_id: string | null
          city: string | null
          client_intake_id: string | null
          company_name: string | null
          contact_id: string | null
          cornerstone_matter_id: string | null
          country: string | null
          created_at: string
          duplicate_review_status: string
          email: string | null
          first_name: string | null
          id: string
          job_title: string | null
          last_engagement_at: string | null
          last_name: string | null
          lead_id: string | null
          lead_source: string | null
          lifecycle_status: string
          mobile_phone: string | null
          next_follow_up_at: string | null
          normalized_email: string | null
          normalized_phone: string | null
          owner_user_id: string | null
          person_kind: string
          phone: string | null
          record_status: string
          referral_source: string | null
          source_system: string
          stage_entered_at: string | null
          stage_id: string
          state: string | null
          updated_at: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          city?: string | null
          client_intake_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          cornerstone_matter_id?: string | null
          country?: string | null
          created_at?: string
          duplicate_review_status?: string
          email?: string | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_engagement_at?: string | null
          last_name?: string | null
          lead_id?: string | null
          lead_source?: string | null
          lifecycle_status?: string
          mobile_phone?: string | null
          next_follow_up_at?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          owner_user_id?: string | null
          person_kind?: string
          phone?: string | null
          record_status?: string
          referral_source?: string | null
          source_system?: string
          stage_entered_at?: string | null
          stage_id: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to_user_id?: string | null
          city?: string | null
          client_intake_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          cornerstone_matter_id?: string | null
          country?: string | null
          created_at?: string
          duplicate_review_status?: string
          email?: string | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_engagement_at?: string | null
          last_name?: string | null
          lead_id?: string | null
          lead_source?: string | null
          lifecycle_status?: string
          mobile_phone?: string | null
          next_follow_up_at?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          owner_user_id?: string | null
          person_kind?: string
          phone?: string | null
          record_status?: string
          referral_source?: string | null
          source_system?: string
          stage_entered_at?: string | null
          stage_id?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_people_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_cornerstone_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_cornerstone_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_cornerstone_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by_user_id: string | null
          value_json: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by_user_id?: string | null
          value_json?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by_user_id?: string | null
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cornerstone_crm_settings_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cornerstone_crm_stages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_closed: boolean
          is_won: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_closed?: boolean
          is_won?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_closed?: boolean
          is_won?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cornerstone_crm_sync_events: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          direction: string
          entity_id: string
          entity_type: string
          error_message: string | null
          event_name: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          payload: Json | null
          provider: string | null
          provider_event_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          direction?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          event_name?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          payload?: Json | null
          provider?: string | null
          provider_event_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          direction?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          event_name?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          payload?: Json | null
          provider?: string | null
          provider_event_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_document_templates: {
        Row: {
          archived_at: string | null
          byte_size: number
          clauses: Json
          created_at: string
          created_by: string | null
          id: string
          label: string
          output_filename: string
          sha256: string
          storage_path: string
          variables: Json
        }
        Insert: {
          archived_at?: string | null
          byte_size: number
          clauses?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          output_filename: string
          sha256: string
          storage_path: string
          variables?: Json
        }
        Update: {
          archived_at?: string | null
          byte_size?: number
          clauses?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          output_filename?: string
          sha256?: string
          storage_path?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "custom_document_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      design_sheets: {
        Row: {
          assets: Json | null
          children: Json | null
          city: string | null
          client_aka: string | null
          client_citizenship: string | null
          client_dob: string | null
          client_domicile: string | null
          client_email: string | null
          client_intake_id: string | null
          client_name: string | null
          client_phone: string | null
          client_pronouns: string | null
          common_trust: string | null
          concerns: string | null
          county: string | null
          created_at: string
          deceased_spouse_name: string | null
          decisions: Json
          disinheritances: Json | null
          distribution_age: number | null
          doc_date: string | null
          drafting_notes: string | null
          excluded_guardian_flag: boolean | null
          excluded_guardian_name: string | null
          executor_alt1: string | null
          executor_alt1_co: string | null
          executor_co: string | null
          executor_primary: string | null
          executor_same_as_trustee: boolean | null
          executor_slots: Json | null
          family_trust_remarriage: string | null
          fiduciary_slot_states: Json | null
          flags: string[] | null
          former_spouse_name: string | null
          goals_notes: string | null
          guardian_alt1: string | null
          guardian_alt1_co: string | null
          guardian_co: string | null
          guardian_primary: string | null
          guardian_slots: Json | null
          hcp_alt1: string | null
          hcp_alt1_co: string | null
          hcp_co: string | null
          hcp_primary: string | null
          hcp_slots: Json | null
          id: string
          include_qdot: string | null
          intake_review_flags: Json
          is_joint: boolean | null
          lock_version: number
          marital_status: string | null
          marital_status_clause: string | null
          marital_trust_remarriage: string | null
          marital_trust_type: string | null
          marriage_date: string | null
          matter_id: string
          notary_commission: string | null
          notary_commission_expiration: string | null
          ordinal_doc_date: string | null
          overrides: Json | null
          plan_type: string | null
          poa_alt1: string | null
          poa_client_co_authority: string | null
          poa_co: string | null
          poa_primary: string | null
          poa_same_as_trustee: boolean | null
          poa_slots: Json | null
          poa_spouse_co_authority: string | null
          real_property_transfer: string | null
          remote_beneficiary: string | null
          remote_beneficiary_charities: Json | null
          remote_beneficiary_individuals: Json | null
          residual_beneficiary_individuals: Json | null
          residuary_beneficiary: string | null
          residuary_distribution: string | null
          restatement: boolean | null
          signing_county: string | null
          signing_date: string | null
          signing_month: string | null
          signing_year: string | null
          specific_bequests: Json | null
          spouse_citizenship: string | null
          spouse_dob: string | null
          spouse_email: string | null
          spouse_executor_same_as_trustee: boolean | null
          spouse_executor_slots: Json | null
          spouse_hcp_slots: Json | null
          spouse_name: string | null
          spouse_phone: string | null
          spouse_poa_slots: Json | null
          spouse_pronouns: string | null
          spouse_trust_name: string | null
          spouse_trustee_slots: Json | null
          staggered_distributions: Json | null
          state: string | null
          status: string
          street: string | null
          temporary_guardian_slots: Json | null
          trust_name: string | null
          trust_protector: string | null
          trust_type: string | null
          trustee_alt1: string | null
          trustee_alt1_co: string | null
          trustee_alt2: string | null
          trustee_co: string | null
          trustee_primary: string | null
          trustee_slots: Json | null
          updated_at: string
          version: number
          withdrawal_right: string | null
          zip: string | null
        }
        Insert: {
          assets?: Json | null
          children?: Json | null
          city?: string | null
          client_aka?: string | null
          client_citizenship?: string | null
          client_dob?: string | null
          client_domicile?: string | null
          client_email?: string | null
          client_intake_id?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_pronouns?: string | null
          common_trust?: string | null
          concerns?: string | null
          county?: string | null
          created_at?: string
          deceased_spouse_name?: string | null
          decisions?: Json
          disinheritances?: Json | null
          distribution_age?: number | null
          doc_date?: string | null
          drafting_notes?: string | null
          excluded_guardian_flag?: boolean | null
          excluded_guardian_name?: string | null
          executor_alt1?: string | null
          executor_alt1_co?: string | null
          executor_co?: string | null
          executor_primary?: string | null
          executor_same_as_trustee?: boolean | null
          executor_slots?: Json | null
          family_trust_remarriage?: string | null
          fiduciary_slot_states?: Json | null
          flags?: string[] | null
          former_spouse_name?: string | null
          goals_notes?: string | null
          guardian_alt1?: string | null
          guardian_alt1_co?: string | null
          guardian_co?: string | null
          guardian_primary?: string | null
          guardian_slots?: Json | null
          hcp_alt1?: string | null
          hcp_alt1_co?: string | null
          hcp_co?: string | null
          hcp_primary?: string | null
          hcp_slots?: Json | null
          id?: string
          include_qdot?: string | null
          intake_review_flags?: Json
          is_joint?: boolean | null
          lock_version?: number
          marital_status?: string | null
          marital_status_clause?: string | null
          marital_trust_remarriage?: string | null
          marital_trust_type?: string | null
          marriage_date?: string | null
          matter_id: string
          notary_commission?: string | null
          notary_commission_expiration?: string | null
          ordinal_doc_date?: string | null
          overrides?: Json | null
          plan_type?: string | null
          poa_alt1?: string | null
          poa_client_co_authority?: string | null
          poa_co?: string | null
          poa_primary?: string | null
          poa_same_as_trustee?: boolean | null
          poa_slots?: Json | null
          poa_spouse_co_authority?: string | null
          real_property_transfer?: string | null
          remote_beneficiary?: string | null
          remote_beneficiary_charities?: Json | null
          remote_beneficiary_individuals?: Json | null
          residual_beneficiary_individuals?: Json | null
          residuary_beneficiary?: string | null
          residuary_distribution?: string | null
          restatement?: boolean | null
          signing_county?: string | null
          signing_date?: string | null
          signing_month?: string | null
          signing_year?: string | null
          specific_bequests?: Json | null
          spouse_citizenship?: string | null
          spouse_dob?: string | null
          spouse_email?: string | null
          spouse_executor_same_as_trustee?: boolean | null
          spouse_executor_slots?: Json | null
          spouse_hcp_slots?: Json | null
          spouse_name?: string | null
          spouse_phone?: string | null
          spouse_poa_slots?: Json | null
          spouse_pronouns?: string | null
          spouse_trust_name?: string | null
          spouse_trustee_slots?: Json | null
          staggered_distributions?: Json | null
          state?: string | null
          status?: string
          street?: string | null
          temporary_guardian_slots?: Json | null
          trust_name?: string | null
          trust_protector?: string | null
          trust_type?: string | null
          trustee_alt1?: string | null
          trustee_alt1_co?: string | null
          trustee_alt2?: string | null
          trustee_co?: string | null
          trustee_primary?: string | null
          trustee_slots?: Json | null
          updated_at?: string
          version?: number
          withdrawal_right?: string | null
          zip?: string | null
        }
        Update: {
          assets?: Json | null
          children?: Json | null
          city?: string | null
          client_aka?: string | null
          client_citizenship?: string | null
          client_dob?: string | null
          client_domicile?: string | null
          client_email?: string | null
          client_intake_id?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_pronouns?: string | null
          common_trust?: string | null
          concerns?: string | null
          county?: string | null
          created_at?: string
          deceased_spouse_name?: string | null
          decisions?: Json
          disinheritances?: Json | null
          distribution_age?: number | null
          doc_date?: string | null
          drafting_notes?: string | null
          excluded_guardian_flag?: boolean | null
          excluded_guardian_name?: string | null
          executor_alt1?: string | null
          executor_alt1_co?: string | null
          executor_co?: string | null
          executor_primary?: string | null
          executor_same_as_trustee?: boolean | null
          executor_slots?: Json | null
          family_trust_remarriage?: string | null
          fiduciary_slot_states?: Json | null
          flags?: string[] | null
          former_spouse_name?: string | null
          goals_notes?: string | null
          guardian_alt1?: string | null
          guardian_alt1_co?: string | null
          guardian_co?: string | null
          guardian_primary?: string | null
          guardian_slots?: Json | null
          hcp_alt1?: string | null
          hcp_alt1_co?: string | null
          hcp_co?: string | null
          hcp_primary?: string | null
          hcp_slots?: Json | null
          id?: string
          include_qdot?: string | null
          intake_review_flags?: Json
          is_joint?: boolean | null
          lock_version?: number
          marital_status?: string | null
          marital_status_clause?: string | null
          marital_trust_remarriage?: string | null
          marital_trust_type?: string | null
          marriage_date?: string | null
          matter_id?: string
          notary_commission?: string | null
          notary_commission_expiration?: string | null
          ordinal_doc_date?: string | null
          overrides?: Json | null
          plan_type?: string | null
          poa_alt1?: string | null
          poa_client_co_authority?: string | null
          poa_co?: string | null
          poa_primary?: string | null
          poa_same_as_trustee?: boolean | null
          poa_slots?: Json | null
          poa_spouse_co_authority?: string | null
          real_property_transfer?: string | null
          remote_beneficiary?: string | null
          remote_beneficiary_charities?: Json | null
          remote_beneficiary_individuals?: Json | null
          residual_beneficiary_individuals?: Json | null
          residuary_beneficiary?: string | null
          residuary_distribution?: string | null
          restatement?: boolean | null
          signing_county?: string | null
          signing_date?: string | null
          signing_month?: string | null
          signing_year?: string | null
          specific_bequests?: Json | null
          spouse_citizenship?: string | null
          spouse_dob?: string | null
          spouse_email?: string | null
          spouse_executor_same_as_trustee?: boolean | null
          spouse_executor_slots?: Json | null
          spouse_hcp_slots?: Json | null
          spouse_name?: string | null
          spouse_phone?: string | null
          spouse_poa_slots?: Json | null
          spouse_pronouns?: string | null
          spouse_trust_name?: string | null
          spouse_trustee_slots?: Json | null
          staggered_distributions?: Json | null
          state?: string | null
          status?: string
          street?: string | null
          temporary_guardian_slots?: Json | null
          trust_name?: string | null
          trust_protector?: string | null
          trust_type?: string | null
          trustee_alt1?: string | null
          trustee_alt1_co?: string | null
          trustee_alt2?: string | null
          trustee_co?: string | null
          trustee_primary?: string | null
          trustee_slots?: Json | null
          updated_at?: string
          version?: number
          withdrawal_right?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_sheets_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_sheets_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_sheets_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_sheets_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "design_sheets_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      doc_selections: {
        Row: {
          created_at: string
          design_sheet_id: string
          doc_type: string | null
          id: string
          party: string | null
          selected: boolean
          sort_order: number | null
          variant: string | null
        }
        Insert: {
          created_at?: string
          design_sheet_id: string
          doc_type?: string | null
          id?: string
          party?: string | null
          selected?: boolean
          sort_order?: number | null
          variant?: string | null
        }
        Update: {
          created_at?: string
          design_sheet_id?: string
          doc_type?: string | null
          id?: string
          party?: string | null
          selected?: boolean
          sort_order?: number | null
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_selections_design_sheet_id_fkey"
            columns: ["design_sheet_id"]
            isOneToOne: false
            referencedRelation: "design_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_audit: {
        Row: {
          action: string
          created_at: string
          document_id: string | null
          document_name: string | null
          id: string
          matter_id: string
          metadata: Json
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          document_id?: string | null
          document_name?: string | null
          id?: string
          matter_id: string
          metadata?: Json
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          document_id?: string | null
          document_name?: string | null
          id?: string
          matter_id?: string
          metadata?: Json
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_audit_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_edits: {
        Row: {
          change_id: string
          context_after: string | null
          context_before: string | null
          created_at: string
          del_w_id: string | null
          deleted_text: string | null
          document_id: string
          id: string
          ins_w_id: string | null
          inserted_text: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          version_id: string
        }
        Insert: {
          change_id: string
          context_after?: string | null
          context_before?: string | null
          created_at?: string
          del_w_id?: string | null
          deleted_text?: string | null
          document_id: string
          id?: string
          ins_w_id?: string | null
          inserted_text?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          version_id: string
        }
        Update: {
          change_id?: string
          context_after?: string | null
          context_before?: string | null
          created_at?: string
          del_w_id?: string | null
          deleted_text?: string | null
          document_id?: string
          id?: string
          ins_w_id?: string | null
          inserted_text?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_edits_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_edits_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_template_events: {
        Row: {
          actor_id: string
          created_at: string
          event_type: string
          id: number
          metadata: Json
          previous_version_id: string | null
          template_id: string
          version_id: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_type: string
          id?: number
          metadata?: Json
          previous_version_id?: string | null
          template_id: string
          version_id?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_type?: string
          id?: number
          metadata?: Json
          previous_version_id?: string | null
          template_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_template_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_events_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_events_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_template_publications: {
        Row: {
          published_at: string
          published_by: string
          template_id: string
          updated_at: string
          version_id: string
        }
        Insert: {
          published_at?: string
          published_by: string
          template_id: string
          updated_at?: string
          version_id: string
        }
        Update: {
          published_at?: string
          published_by?: string
          template_id?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_template_publications_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_publications_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_template_versions: {
        Row: {
          byte_size: number
          canceled_at: string | null
          canceled_by: string | null
          created_at: string
          id: string
          original_filename: string
          sha256: string
          storage_path: string
          template_id: string
          uploaded_by: string
          validated_at: string | null
          validated_by: string | null
          validated_with_matter_id: string | null
          validation_report: Json | null
          validation_status: string
          version_number: number
        }
        Insert: {
          byte_size: number
          canceled_at?: string | null
          canceled_by?: string | null
          created_at?: string
          id?: string
          original_filename: string
          sha256: string
          storage_path: string
          template_id: string
          uploaded_by: string
          validated_at?: string | null
          validated_by?: string | null
          validated_with_matter_id?: string | null
          validation_report?: Json | null
          validation_status?: string
          version_number?: number
        }
        Update: {
          byte_size?: number
          canceled_at?: string | null
          canceled_by?: string | null
          created_at?: string
          id?: string
          original_filename?: string
          sha256?: string
          storage_path?: string
          template_id?: string
          uploaded_by?: string
          validated_at?: string | null
          validated_by?: string | null
          validated_with_matter_id?: string | null
          validation_report?: Json | null
          validation_status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_canceled_by_fkey"
            columns: ["canceled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_validated_with_matter_id_fkey"
            columns: ["validated_with_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_validated_with_matter_id_fkey"
            columns: ["validated_with_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "document_template_versions_validated_with_matter_id_fkey"
            columns: ["validated_with_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      document_text_layers: {
        Row: {
          aligned_to_layer_id: string | null
          blocks: Json
          created_at: string
          document_version_id: string
          extractor: string
          extractor_version: string
          id: string
          page_count: number | null
          source_kind: string
          source_sha256: string
          spans: Json
          status: string
          text: string
        }
        Insert: {
          aligned_to_layer_id?: string | null
          blocks?: Json
          created_at?: string
          document_version_id: string
          extractor: string
          extractor_version: string
          id?: string
          page_count?: number | null
          source_kind: string
          source_sha256: string
          spans?: Json
          status?: string
          text: string
        }
        Update: {
          aligned_to_layer_id?: string | null
          blocks?: Json
          created_at?: string
          document_version_id?: string
          extractor?: string
          extractor_version?: string
          id?: string
          page_count?: number | null
          source_kind?: string
          source_sha256?: string
          spans?: Json
          status?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_text_layers_aligned_to_layer_id_fkey"
            columns: ["aligned_to_layer_id"]
            isOneToOne: false
            referencedRelation: "document_text_layers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_text_layers_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_id: string
          file_type: string | null
          filename: string | null
          id: string
          pdf_r2_key: string | null
          r2_key: string
          size_bytes: number
          source: string
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_id: string
          file_type?: string | null
          filename?: string | null
          id?: string
          pdf_r2_key?: string | null
          r2_key: string
          size_bytes?: number
          source?: string
          version_number?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_id?: string
          file_type?: string | null
          filename?: string | null
          id?: string
          pdf_r2_key?: string | null
          r2_key?: string
          size_bytes?: number
          source?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_generation_runs: {
        Row: {
          created_at: string
          created_by: string
          error: string | null
          id: string
          lease_expires_at: string
          matter_id: string
          outcomes: Json
          request_hash: string
          requested_documents: string[]
          source_revision: string
          status: string
          updated_at: string
          worker_token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          error?: string | null
          id: string
          lease_expires_at: string
          matter_id: string
          outcomes?: Json
          request_hash: string
          requested_documents: string[]
          source_revision: string
          status: string
          updated_at?: string
          worker_token: string
        }
        Update: {
          created_at?: string
          created_by?: string
          error?: string | null
          id?: string
          lease_expires_at?: string
          matter_id?: string
          outcomes?: Json
          request_hash?: string
          requested_documents?: string[]
          source_revision?: string
          status?: string
          updated_at?: string
          worker_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_generation_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_generation_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "draft_generation_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      draft_log: {
        Row: {
          created_at: string
          design_sheet_id: string | null
          doc_type: string | null
          documents_generated: string[] | null
          drafted_by: string | null
          id: string
          matter_id: string | null
          missing_fields: Json | null
          model: string | null
          sheet_version: number | null
          status: string | null
        }
        Insert: {
          created_at?: string
          design_sheet_id?: string | null
          doc_type?: string | null
          documents_generated?: string[] | null
          drafted_by?: string | null
          id?: string
          matter_id?: string | null
          missing_fields?: Json | null
          model?: string | null
          sheet_version?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string
          design_sheet_id?: string | null
          doc_type?: string | null
          documents_generated?: string[] | null
          drafted_by?: string | null
          id?: string
          matter_id?: string | null
          missing_fields?: Json | null
          model?: string | null
          sheet_version?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_log_design_sheet_id_fkey"
            columns: ["design_sheet_id"]
            isOneToOne: false
            referencedRelation: "design_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_log_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_log_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "draft_log_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          bcc: string[]
          body_html: string
          cc: string[]
          context_id: string | null
          context_type: string
          created_at: string
          document_ids: string[]
          id: string
          include_signature: boolean
          subject: string
          template_id: string | null
          to_email: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bcc?: string[]
          body_html?: string
          cc?: string[]
          context_id?: string | null
          context_type: string
          created_at?: string
          document_ids?: string[]
          id?: string
          include_signature?: boolean
          subject?: string
          template_id?: string | null
          to_email?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bcc?: string[]
          body_html?: string
          cc?: string[]
          context_id?: string | null
          context_type?: string
          created_at?: string
          document_ids?: string[]
          id?: string
          include_signature?: boolean
          subject?: string
          template_id?: string | null
          to_email?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          actor_id: string | null
          actual_to: string | null
          bcc: string | null
          category: string | null
          cc: string | null
          contact_id: string | null
          created_at: string
          error: string | null
          html: string | null
          id: string
          intended_to: string | null
          lead_id: string | null
          matter_id: string | null
          provider: string | null
          provider_message_id: string | null
          reply_to: string | null
          resend_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          to_email: string | null
        }
        Insert: {
          actor_id?: string | null
          actual_to?: string | null
          bcc?: string | null
          category?: string | null
          cc?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          html?: string | null
          id?: string
          intended_to?: string | null
          lead_id?: string | null
          matter_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reply_to?: string | null
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          to_email?: string | null
        }
        Update: {
          actor_id?: string | null
          actual_to?: string | null
          bcc?: string | null
          category?: string | null
          cc?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          html?: string | null
          id?: string
          intended_to?: string | null
          lead_id?: string | null
          matter_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reply_to?: string | null
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "email_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "email_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          category: string
          mode: string
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          mode?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          mode?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          subject: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          subject: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          subject?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_triage_ignore_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          value: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          value?: string
        }
        Relationships: []
      }
      email_triage_scans: {
        Row: {
          actor_id: string | null
          drafts_generated: number
          error: string | null
          finished_at: string | null
          id: string
          skipped_automated: number
          skipped_internal: number
          started_at: string
          threads_examined: number
          threads_listed: number
          threads_queued: number
          threads_resolved: number
          trigger: string
        }
        Insert: {
          actor_id?: string | null
          drafts_generated?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          skipped_automated?: number
          skipped_internal?: number
          started_at?: string
          threads_examined?: number
          threads_listed?: number
          threads_queued?: number
          threads_resolved?: number
          trigger: string
        }
        Update: {
          actor_id?: string | null
          drafts_generated?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          skipped_automated?: number
          skipped_internal?: number
          started_at?: string
          threads_examined?: number
          threads_listed?: number
          threads_queued?: number
          threads_resolved?: number
          trigger?: string
        }
        Relationships: []
      }
      email_triage_threads: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          classification: string
          classification_reason: string | null
          client_intake_id: string | null
          connection_email: string
          contact_id: string | null
          created_at: string
          dismissed_at: string | null
          dismissed_reason: string | null
          draft_body: string | null
          draft_error: string | null
          draft_generated_at: string | null
          draft_model: string | null
          draft_subject: string | null
          first_seen_at: string
          gmail_draft_id: string | null
          gmail_draft_message_id: string | null
          gmail_message_id: string
          gmail_thread_id: string
          id: string
          last_scanned_at: string
          matter_id: string | null
          message_id_header: string | null
          received_at: string
          references_header: string | null
          replied_at: string | null
          sender_domain: string
          sender_email: string
          sender_name: string | null
          snippet: string | null
          status: string
          subject: string | null
          thread_message_count: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          classification: string
          classification_reason?: string | null
          client_intake_id?: string | null
          connection_email: string
          contact_id?: string | null
          created_at?: string
          dismissed_at?: string | null
          dismissed_reason?: string | null
          draft_body?: string | null
          draft_error?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          draft_subject?: string | null
          first_seen_at?: string
          gmail_draft_id?: string | null
          gmail_draft_message_id?: string | null
          gmail_message_id: string
          gmail_thread_id: string
          id?: string
          last_scanned_at?: string
          matter_id?: string | null
          message_id_header?: string | null
          received_at: string
          references_header?: string | null
          replied_at?: string | null
          sender_domain: string
          sender_email: string
          sender_name?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          thread_message_count?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          classification?: string
          classification_reason?: string | null
          client_intake_id?: string | null
          connection_email?: string
          contact_id?: string | null
          created_at?: string
          dismissed_at?: string | null
          dismissed_reason?: string | null
          draft_body?: string | null
          draft_error?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          draft_subject?: string | null
          first_seen_at?: string
          gmail_draft_id?: string | null
          gmail_draft_message_id?: string | null
          gmail_message_id?: string
          gmail_thread_id?: string
          id?: string
          last_scanned_at?: string
          matter_id?: string | null
          message_id_header?: string | null
          received_at?: string
          references_header?: string | null
          replied_at?: string | null
          sender_domain?: string
          sender_email?: string
          sender_name?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          thread_message_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_triage_threads_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_triage_threads_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_triage_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "email_triage_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "email_triage_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_triage_threads_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_triage_threads_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "email_triage_threads_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      engagement_agreement_recipients: {
        Row: {
          agreement_id: string
          created_at: string
          declined_at: string | null
          email: string
          external_recipient_id: string | null
          firma_recipient_id: string | null
          id: string
          last_reminded_at: string | null
          name: string
          recipient_order: number
          role: string
          sent_at: string | null
          signed_at: string | null
          status: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          agreement_id: string
          created_at?: string
          declined_at?: string | null
          email: string
          external_recipient_id?: string | null
          firma_recipient_id?: string | null
          id?: string
          last_reminded_at?: string | null
          name: string
          recipient_order: number
          role: string
          sent_at?: string | null
          signed_at?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          agreement_id?: string
          created_at?: string
          declined_at?: string | null
          email?: string
          external_recipient_id?: string | null
          firma_recipient_id?: string | null
          id?: string
          last_reminded_at?: string | null
          name?: string
          recipient_order?: number
          role?: string
          sent_at?: string | null
          signed_at?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_agreement_recipients_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_agreement_revisions: {
        Row: {
          agreement_id: string
          created_at: string
          html_r2_key: string | null
          id: string
          input_snapshot: Json
          master_version: string
          pdf_r2_key: string | null
          render_sha256: string
          render_snapshot: Json
          revision_number: number
        }
        Insert: {
          agreement_id: string
          created_at?: string
          html_r2_key?: string | null
          id?: string
          input_snapshot: Json
          master_version: string
          pdf_r2_key?: string | null
          render_sha256: string
          render_snapshot: Json
          revision_number: number
        }
        Update: {
          agreement_id?: string
          created_at?: string
          html_r2_key?: string | null
          id?: string
          input_snapshot?: Json
          master_version?: string
          pdf_r2_key?: string | null
          render_sha256?: string
          render_snapshot?: Json
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagement_agreement_revisions_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_agreements: {
        Row: {
          active_revision_id: string | null
          approval_nonce: string | null
          completed_at: string | null
          completed_r2_key: string | null
          created_at: string
          external_request_id: string | null
          firma_request_id: string | null
          id: string
          last_provider_sync_at: string | null
          lead_id: string | null
          legacy_envelope_id: string | null
          matter_id: string | null
          prepared_by: string | null
          provider: string
          provider_sync_error: string | null
          provider_sync_error_at: string | null
          send_lease_expires_at: string | null
          send_lease_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          active_revision_id?: string | null
          approval_nonce?: string | null
          completed_at?: string | null
          completed_r2_key?: string | null
          created_at?: string
          external_request_id?: string | null
          firma_request_id?: string | null
          id?: string
          last_provider_sync_at?: string | null
          lead_id?: string | null
          legacy_envelope_id?: string | null
          matter_id?: string | null
          prepared_by?: string | null
          provider?: string
          provider_sync_error?: string | null
          provider_sync_error_at?: string | null
          send_lease_expires_at?: string | null
          send_lease_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          active_revision_id?: string | null
          approval_nonce?: string | null
          completed_at?: string | null
          completed_r2_key?: string | null
          created_at?: string
          external_request_id?: string | null
          firma_request_id?: string | null
          id?: string
          last_provider_sync_at?: string | null
          lead_id?: string | null
          legacy_envelope_id?: string | null
          matter_id?: string | null
          prepared_by?: string | null
          provider?: string
          provider_sync_error?: string | null
          provider_sync_error_at?: string | null
          send_lease_expires_at?: string | null
          send_lease_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_agreements_active_revision_fkey"
            columns: ["id", "active_revision_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreement_revisions"
            referencedColumns: ["agreement_id", "id"]
          },
          {
            foreignKeyName: "engagement_agreements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_agreements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_agreements_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_agreements_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "engagement_agreements_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      engagement_clause_library: {
        Row: {
          approved_text: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          practice_areas: string[]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_text: string
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          practice_areas?: string[]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_text?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          practice_areas?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      engagement_esign_artifacts: {
        Row: {
          agreement_id: string
          byte_size: number
          created_at: string
          external_request_id: string | null
          id: string
          kind: string
          mime_type: string
          provider: string
          r2_key: string
          retrieved_at: string
          sha256: string
        }
        Insert: {
          agreement_id: string
          byte_size: number
          created_at?: string
          external_request_id?: string | null
          id?: string
          kind: string
          mime_type?: string
          provider: string
          r2_key: string
          retrieved_at?: string
          sha256: string
        }
        Update: {
          agreement_id?: string
          byte_size?: number
          created_at?: string
          external_request_id?: string | null
          id?: string
          kind?: string
          mime_type?: string
          provider?: string
          r2_key?: string
          retrieved_at?: string
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_esign_artifacts_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_audit_events: {
        Row: {
          agreement_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          ip: unknown
          occurred_at: string
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          agreement_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          ip?: unknown
          occurred_at?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          agreement_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          ip?: unknown
          occurred_at?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_audit_events_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_audit_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "esign_signing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_signature_artifacts: {
        Row: {
          adoption_method: string
          consent_text_sha256: string
          created_at: string
          id: string
          session_id: string
          signature_png_r2_key: string | null
          typed_name: string | null
        }
        Insert: {
          adoption_method: string
          consent_text_sha256: string
          created_at?: string
          id?: string
          session_id: string
          signature_png_r2_key?: string | null
          typed_name?: string | null
        }
        Update: {
          adoption_method?: string
          consent_text_sha256?: string
          created_at?: string
          id?: string
          session_id?: string
          signature_png_r2_key?: string | null
          typed_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_signature_artifacts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "esign_signing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_signing_sessions: {
        Row: {
          agreement_id: string
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          expires_at: string
          id: string
          recipient_key: string
          signed_at: string | null
          status: string
          token_hash: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          agreement_id: string
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at: string
          id?: string
          recipient_key: string
          signed_at?: string | null
          status?: string
          token_hash: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          agreement_id?: string
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at?: string
          id?: string
          recipient_key?: string
          signed_at?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_signing_sessions_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_webhook_events: {
        Row: {
          agreement_id: string | null
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          external_request_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
          provider: string
        }
        Insert: {
          agreement_id?: string | null
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          external_request_id?: string | null
          id?: string
          payload: Json
          processed_at?: string | null
          processing_started_at?: string | null
          provider: string
        }
        Update: {
          agreement_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          external_request_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "esign_webhook_events_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      estate_clause_preview_evidence: {
        Row: {
          clause_id: string
          created_at: string
          created_by: string
          dependency_revision_ids: Json
          document_types: string[]
          id: string
          representative_matter_id: string
          revision_content_hash: string
          revision_id: string
          template_publication_revision_ids: Json
          template_snapshot_hash: string
          validation_report: Json
        }
        Insert: {
          clause_id: string
          created_at?: string
          created_by: string
          dependency_revision_ids?: Json
          document_types: string[]
          id?: string
          representative_matter_id: string
          revision_content_hash: string
          revision_id: string
          template_publication_revision_ids?: Json
          template_snapshot_hash: string
          validation_report: Json
        }
        Update: {
          clause_id?: string
          created_at?: string
          created_by?: string
          dependency_revision_ids?: Json
          document_types?: string[]
          id?: string
          representative_matter_id?: string
          revision_content_hash?: string
          revision_id?: string
          template_publication_revision_ids?: Json
          template_snapshot_hash?: string
          validation_report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estate_clause_preview_evidenc_revision_id_clause_id_revisi_fkey"
            columns: ["revision_id", "clause_id", "revision_content_hash"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id", "content_hash"]
          },
          {
            foreignKeyName: "estate_clause_preview_evidence_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_preview_evidence_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_preview_evidence_representative_matter_id_fkey"
            columns: ["representative_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_preview_evidence_representative_matter_id_fkey"
            columns: ["representative_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "estate_clause_preview_evidence_representative_matter_id_fkey"
            columns: ["representative_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      estate_clause_publications: {
        Row: {
          clause_id: string
          current_revision_id: string
          published_at: string
          published_by: string
          updated_at: string
        }
        Insert: {
          clause_id: string
          current_revision_id: string
          published_at?: string
          published_by: string
          updated_at?: string
        }
        Update: {
          clause_id?: string
          current_revision_id?: string
          published_at?: string
          published_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estate_clause_publications_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: true
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_publications_current_revision_id_clause_id_fkey"
            columns: ["current_revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
          {
            foreignKeyName: "estate_clause_publications_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      estate_clause_review_events: {
        Row: {
          actor_id: string
          clause_id: string
          comment: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          revision_id: string
          validation_report: Json | null
        }
        Insert: {
          actor_id: string
          clause_id: string
          comment?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          revision_id: string
          validation_report?: Json | null
        }
        Update: {
          actor_id?: string
          clause_id?: string
          comment?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          revision_id?: string
          validation_report?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "estate_clause_review_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_review_events_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_review_events_revision_id_clause_id_fkey"
            columns: ["revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
        ]
      }
      estate_clause_revisions: {
        Row: {
          author_id: string
          base_published_revision_id: string | null
          change_summary: string
          clause_id: string
          clause_text: string
          condition_field: string | null
          content_hash: string
          id: string
          nested_clause_keys: string[]
          required_fields: string[]
          revision_number: number
          submitted_at: string
          validation_report: Json
          validation_status: string
        }
        Insert: {
          author_id: string
          base_published_revision_id?: string | null
          change_summary: string
          clause_id: string
          clause_text: string
          condition_field?: string | null
          content_hash: string
          id?: string
          nested_clause_keys?: string[]
          required_fields?: string[]
          revision_number: number
          submitted_at?: string
          validation_report: Json
          validation_status: string
        }
        Update: {
          author_id?: string
          base_published_revision_id?: string | null
          change_summary?: string
          clause_id?: string
          clause_text?: string
          condition_field?: string | null
          content_hash?: string
          id?: string
          nested_clause_keys?: string[]
          required_fields?: string[]
          revision_number?: number
          submitted_at?: string
          validation_report?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "estate_clause_revisions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_revisions_base_published_revision_id_clause__fkey"
            columns: ["base_published_revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
          {
            foreignKeyName: "estate_clause_revisions_base_published_revision_id_fkey"
            columns: ["base_published_revision_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_revisions_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
        ]
      }
      estate_clause_working_drafts: {
        Row: {
          author_id: string
          base_published_revision_id: string | null
          change_summary: string
          clause_id: string
          clause_text: string
          condition_field: string | null
          content_hash: string
          created_at: string
          id: string
          nested_clause_keys: string[]
          required_fields: string[]
          source_review_revision_id: string | null
          updated_at: string
          validation_report: Json
          validation_status: string
        }
        Insert: {
          author_id: string
          base_published_revision_id?: string | null
          change_summary: string
          clause_id: string
          clause_text: string
          condition_field?: string | null
          content_hash: string
          created_at?: string
          id?: string
          nested_clause_keys?: string[]
          required_fields?: string[]
          source_review_revision_id?: string | null
          updated_at?: string
          validation_report?: Json
          validation_status?: string
        }
        Update: {
          author_id?: string
          base_published_revision_id?: string | null
          change_summary?: string
          clause_id?: string
          clause_text?: string
          condition_field?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          nested_clause_keys?: string[]
          required_fields?: string[]
          source_review_revision_id?: string | null
          updated_at?: string
          validation_report?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "estate_clause_working_drafts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_working_drafts_base_published_revision_id_cl_fkey"
            columns: ["base_published_revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
          {
            foreignKeyName: "estate_clause_working_drafts_base_published_revision_id_fkey"
            columns: ["base_published_revision_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_working_drafts_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estate_clause_working_drafts_source_review_revision_id_cla_fkey"
            columns: ["source_review_revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
        ]
      }
      estate_clauses: {
        Row: {
          clause_key: string
          created_at: string
          created_by: string
          document_types: string[]
          id: string
          is_active: boolean
          jurisdiction: string
          title: string
          updated_at: string
        }
        Insert: {
          clause_key: string
          created_at?: string
          created_by: string
          document_types: string[]
          id?: string
          is_active?: boolean
          jurisdiction?: string
          title: string
          updated_at?: string
        }
        Update: {
          clause_key?: string
          created_at?: string
          created_by?: string
          document_types?: string[]
          id?: string
          is_active?: boolean
          jurisdiction?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estate_clauses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      external_bookings: {
        Row: {
          attendee_email: string | null
          attendee_name: string | null
          booking_id: string | null
          booking_uid: string
          created_at: string
          end_time: string | null
          event_key: string | null
          event_label: string | null
          event_slug: string | null
          id: string
          linked_lead_id: string | null
          linked_matter_id: string | null
          provider: string
          raw_payload: Json
          start_time: string | null
          status: string
          trigger_event: string
          unresolved_reason: string | null
          updated_at: string
        }
        Insert: {
          attendee_email?: string | null
          attendee_name?: string | null
          booking_id?: string | null
          booking_uid: string
          created_at?: string
          end_time?: string | null
          event_key?: string | null
          event_label?: string | null
          event_slug?: string | null
          id?: string
          linked_lead_id?: string | null
          linked_matter_id?: string | null
          provider?: string
          raw_payload?: Json
          start_time?: string | null
          status: string
          trigger_event: string
          unresolved_reason?: string | null
          updated_at?: string
        }
        Update: {
          attendee_email?: string | null
          attendee_name?: string | null
          booking_id?: string | null
          booking_uid?: string
          created_at?: string
          end_time?: string | null
          event_key?: string | null
          event_label?: string | null
          event_slug?: string | null
          id?: string
          linked_lead_id?: string | null
          linked_matter_id?: string | null
          provider?: string
          raw_payload?: Json
          start_time?: string | null
          status?: string
          trigger_event?: string
          unresolved_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calcom_bookings_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calcom_bookings_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calcom_bookings_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calcom_bookings_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "calcom_bookings_linked_matter_id_fkey"
            columns: ["linked_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      firm_holidays: {
        Row: {
          holiday_date: string
          name: string | null
        }
        Insert: {
          holiday_date: string
          name?: string | null
        }
        Update: {
          holiday_date?: string
          name?: string | null
        }
        Relationships: []
      }
      firm_settings: {
        Row: {
          admitted: string | null
          attorney_name: string | null
          attorney_short_name: string | null
          bar_number: string | null
          billing_annual_goal_cents: number
          billing_milestones_enabled: boolean
          calendar_daily_target_minutes: number
          city: string | null
          durable_workflow_jobs_enabled: boolean
          email: string | null
          email_logo_header: boolean
          email_signature_default: boolean
          email_signature_html: string | null
          email_triage_enabled: boolean
          email_triage_query: string | null
          esign_native_enabled: boolean
          estate_tax_schedules: Json
          firm_name: string | null
          id: number
          phone: string | null
          probate_track_enabled: boolean
          specialization: string | null
          state: string | null
          street: string | null
          updated_at: string
          updated_by: string | null
          website: string | null
          zip: string | null
        }
        Insert: {
          admitted?: string | null
          attorney_name?: string | null
          attorney_short_name?: string | null
          bar_number?: string | null
          billing_annual_goal_cents?: number
          billing_milestones_enabled?: boolean
          calendar_daily_target_minutes?: number
          city?: string | null
          durable_workflow_jobs_enabled?: boolean
          email?: string | null
          email_logo_header?: boolean
          email_signature_default?: boolean
          email_signature_html?: string | null
          email_triage_enabled?: boolean
          email_triage_query?: string | null
          esign_native_enabled?: boolean
          estate_tax_schedules?: Json
          firm_name?: string | null
          id?: number
          phone?: string | null
          probate_track_enabled?: boolean
          specialization?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          zip?: string | null
        }
        Update: {
          admitted?: string | null
          attorney_name?: string | null
          attorney_short_name?: string | null
          bar_number?: string | null
          billing_annual_goal_cents?: number
          billing_milestones_enabled?: boolean
          calendar_daily_target_minutes?: number
          city?: string | null
          durable_workflow_jobs_enabled?: boolean
          email?: string | null
          email_logo_header?: boolean
          email_signature_default?: boolean
          email_signature_html?: string | null
          email_triage_enabled?: boolean
          email_triage_query?: string | null
          esign_native_enabled?: boolean
          estate_tax_schedules?: Json
          firm_name?: string | null
          id?: number
          phone?: string | null
          probate_track_enabled?: boolean
          specialization?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      firma_webhook_events: {
        Row: {
          agreement_id: string | null
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          firma_request_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
        }
        Insert: {
          agreement_id?: string | null
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          firma_request_id?: string | null
          id?: string
          payload: Json
          processed_at?: string | null
          processing_started_at?: string | null
        }
        Update: {
          agreement_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          firma_request_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firma_webhook_events_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "engagement_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_document_clause_revisions: {
        Row: {
          clause_id: string
          clause_key: string
          content_hash: string
          created_at: string
          document_version_id: string
          id: string
          included: boolean
          inclusion_position: number | null
          override_action: string | null
          override_id: string | null
          revision_id: string
          selection_reason: string
        }
        Insert: {
          clause_id: string
          clause_key: string
          content_hash: string
          created_at?: string
          document_version_id: string
          id?: string
          included: boolean
          inclusion_position?: number | null
          override_action?: string | null
          override_id?: string | null
          revision_id: string
          selection_reason: string
        }
        Update: {
          clause_id?: string
          clause_key?: string
          content_hash?: string
          created_at?: string
          document_version_id?: string
          id?: string
          included?: boolean
          inclusion_position?: number | null
          override_action?: string | null
          override_id?: string | null
          revision_id?: string
          selection_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_document_clause_rev_revision_id_clause_id_conten_fkey"
            columns: ["revision_id", "clause_id", "content_hash"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id", "content_hash"]
          },
          {
            foreignKeyName: "generated_document_clause_revisions_clause_id_clause_key_fkey"
            columns: ["clause_id", "clause_key"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id", "clause_key"]
          },
          {
            foreignKeyName: "generated_document_clause_revisions_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_clause_revisions_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_clause_revisions_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "matter_estate_clause_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_document_clause_revisions_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_documents: {
        Row: {
          client_intake_id: string
          content_type: string
          created_at: string
          id: string
          kind: string
          name: string
          r2_key: string
          size: number
          uploaded_by: string | null
        }
        Insert: {
          client_intake_id: string
          content_type?: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          r2_key: string
          size?: number
          uploaded_by?: string | null
        }
        Update: {
          client_intake_id?: string
          content_type?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          r2_key?: string
          size?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_documents_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_documents_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_invite_audit: {
        Row: {
          client_intake_id: string | null
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          client_intake_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Update: {
          client_intake_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_invite_audit_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_invite_audit_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_entity_leases: {
        Row: {
          entity_id: string
          entity_type: string
          lease_expires_at: string
          lease_token: string
          provider: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          lease_expires_at: string
          lease_token: string
          provider: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          lease_expires_at?: string
          lease_token?: string
          provider?: string
        }
        Relationships: []
      }
      integration_external_records: {
        Row: {
          created_at: string
          external_id: string | null
          external_record_type: string
          id: string
          idempotency_key: string
          internal_entity_id: string
          internal_entity_type: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_succeeded_at: string | null
          metadata: Json
          provider: string
          request_hash: string | null
          request_snapshot: Json | null
          source_version: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          external_record_type: string
          id?: string
          idempotency_key: string
          internal_entity_id: string
          internal_entity_type: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_succeeded_at?: string | null
          metadata?: Json
          provider: string
          request_hash?: string | null
          request_snapshot?: Json | null
          source_version: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          external_record_type?: string
          id?: string
          idempotency_key?: string
          internal_entity_id?: string
          internal_entity_type?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_succeeded_at?: string | null
          metadata?: Json
          provider?: string
          request_hash?: string | null
          request_snapshot?: Json | null
          source_version?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          created_at: string
          id: number
          lawmatics_appointment_sync_enabled: boolean
          lawmatics_event_type_id_map: Json
          lawmatics_last_check_error: string | null
          lawmatics_last_checked_at: string | null
          lawmatics_location_id_map: Json
          lawmatics_user_ids: Json
          statular_doc_id_map: Json
          statular_drafter_id: string | null
          statular_sync_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          lawmatics_appointment_sync_enabled?: boolean
          lawmatics_event_type_id_map?: Json
          lawmatics_last_check_error?: string | null
          lawmatics_last_checked_at?: string | null
          lawmatics_location_id_map?: Json
          lawmatics_user_ids?: Json
          statular_doc_id_map?: Json
          statular_drafter_id?: string | null
          statular_sync_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          lawmatics_appointment_sync_enabled?: boolean
          lawmatics_event_type_id_map?: Json
          lawmatics_last_check_error?: string | null
          lawmatics_last_checked_at?: string | null
          lawmatics_location_id_map?: Json
          lawmatics_user_ids?: Json
          statular_doc_id_map?: Json
          statular_drafter_id?: string | null
          statular_sync_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      invoice_checkout_sessions: {
        Row: {
          amount_cents: number
          checkout_url: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          invoice_id: string
          payment_group_id: string | null
          provider: string
          provider_payment_intent_id: string | null
          provider_session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invoice_id: string
          payment_group_id?: string | null
          provider: string
          provider_payment_intent_id?: string | null
          provider_session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invoice_id?: string
          payment_group_id?: string | null
          provider?: string
          provider_payment_intent_id?: string | null
          provider_session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_checkout_sessions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount_cents: number
          billing_item_id: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          kind: string
          position: number
        }
        Insert: {
          amount_cents: number
          billing_item_id?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          kind: string
          position: number
        }
        Update: {
          amount_cents?: number
          billing_item_id?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          kind?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_billing_item_id_fkey"
            columns: ["billing_item_id"]
            isOneToOne: false
            referencedRelation: "billing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_sequences: {
        Row: {
          last_value: number
          year: number
        }
        Insert: {
          last_value?: number
          year: number
        }
        Update: {
          last_value?: number
          year?: number
        }
        Relationships: []
      }
      invoice_reminders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          cadence_week: string
          created_at: string
          escalation_level: string
          id: string
          invoice_id: string
          recipient_email: string
          sent_at: string | null
          status: string
          subject: string
          suppressed_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          cadence_week: string
          created_at?: string
          escalation_level: string
          id?: string
          invoice_id: string
          recipient_email: string
          sent_at?: string | null
          status?: string
          subject: string
          suppressed_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          cadence_week?: string
          created_at?: string
          escalation_level?: string
          id?: string
          invoice_id?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
          subject?: string
          suppressed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          bill_to_email?: string | null
          bill_to_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_of_invoice_id?: string | null
          docx_document_id?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string | null
          issued_at?: string | null
          kind?: string
          last_reminded_at?: string | null
          matter_id: string
          notes?: string | null
          number?: string | null
          number_year?: number | null
          paid_at?: string | null
          payment_link?: string | null
          pdf_document_id?: string | null
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          terms?: string | null
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          bill_to_email?: string | null
          bill_to_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_of_invoice_id?: string | null
          docx_document_id?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string | null
          issued_at?: string | null
          kind?: string
          last_reminded_at?: string | null
          matter_id?: string
          notes?: string | null
          number?: string | null
          number_year?: number | null
          paid_at?: string | null
          payment_link?: string | null
          pdf_document_id?: string | null
          sent_at?: string | null
          status?: string
          subtotal_cents?: number
          terms?: string | null
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_credit_of_invoice_id_fkey"
            columns: ["credit_of_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_docx_document_id_fkey"
            columns: ["docx_document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "invoices_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "invoices_pdf_document_id_fkey"
            columns: ["pdf_document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lawmatics_tokens: {
        Row: {
          access_token: string
          expires_at: string | null
          id: string
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at?: string | null
          id: string
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lead_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: string
          lead_id: string
          source_matter_activity_id: string | null
          title: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          lead_id: string
          source_matter_activity_id?: string | null
          title: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          lead_id?: string
          source_matter_activity_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activity_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activity_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activity_source_matter_activity_id_fkey"
            columns: ["source_matter_activity_id"]
            isOneToOne: false
            referencedRelation: "matter_activity"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_meeting_notes: {
        Row: {
          actor_id: string
          attendees: string[]
          body: string
          created_at: string
          granola_note_id: string | null
          id: string
          lead_id: string
          meeting_date: string
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          attendees?: string[]
          body: string
          created_at?: string
          granola_note_id?: string | null
          id?: string
          lead_id: string
          meeting_date: string
          source?: string
          title: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          attendees?: string[]
          body?: string
          created_at?: string
          granola_note_id?: string | null
          id?: string
          lead_id?: string
          meeting_date?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_meeting_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_meeting_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          actor_id: string
          body: string
          created_at: string
          id: string
          lead_id: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          body: string
          created_at?: string
          id?: string
          lead_id: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_activity: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: string
          matter_id: string
          metadata: Json | null
          title: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          matter_id: string
          metadata?: Json | null
          title: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          matter_id?: string
          metadata?: Json | null
          title?: string
        }
        Relationships: []
      }
      matter_assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          matter_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          matter_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          matter_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      matter_contacts: {
        Row: {
          child_relationship: string | null
          contact_id: string
          created_at: string
          for_party: string | null
          from_prior_relationship: boolean | null
          id: string
          is_minor: boolean | null
          matter_id: string
          parentage: string | null
          relationship_label: string | null
          relationship_type: string
          updated_at: string
        }
        Insert: {
          child_relationship?: string | null
          contact_id: string
          created_at?: string
          for_party?: string | null
          from_prior_relationship?: boolean | null
          id?: string
          is_minor?: boolean | null
          matter_id: string
          parentage?: string | null
          relationship_label?: string | null
          relationship_type: string
          updated_at?: string
        }
        Update: {
          child_relationship?: string | null
          contact_id?: string
          created_at?: string
          for_party?: string | null
          from_prior_relationship?: boolean | null
          id?: string
          is_minor?: boolean | null
          matter_id?: string
          parentage?: string | null
          relationship_label?: string | null
          relationship_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "matter_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "matter_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_contacts_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_contacts_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_contacts_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_deletions: {
        Row: {
          client_intake_id: string | null
          deleted_at: string
          deleted_by: string | null
          deleted_by_email: string | null
          documents_deleted: number
          had_signed_engagement: boolean
          id: string
          matter_created_at: string | null
          matter_id: string
          matter_name: string | null
          matter_number: string | null
          reason: string | null
          relationship_status: string
          stage: string | null
          status: string
        }
        Insert: {
          client_intake_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_email?: string | null
          documents_deleted?: number
          had_signed_engagement?: boolean
          id?: string
          matter_created_at?: string | null
          matter_id: string
          matter_name?: string | null
          matter_number?: string | null
          reason?: string | null
          relationship_status: string
          stage?: string | null
          status: string
        }
        Update: {
          client_intake_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_email?: string | null
          documents_deleted?: number
          had_signed_engagement?: boolean
          id?: string
          matter_created_at?: string | null
          matter_id?: string
          matter_name?: string | null
          matter_number?: string | null
          reason?: string | null
          relationship_status?: string
          stage?: string | null
          status?: string
        }
        Relationships: []
      }
      matter_details: {
        Row: {
          billing_type: string | null
          claim_amount: number | null
          claim_submitted_date: string | null
          client_id: string
          client_review_date: string | null
          client_status: string | null
          clio_matter_number: string | null
          closed_date: string | null
          closing_package_sent_date: string | null
          co_counsel: string | null
          conflict_check_completed: boolean | null
          conflict_check_date: string | null
          conflict_cleared: boolean | null
          created_at: string
          credit_shelter_provisions: string | null
          deed_recorded: boolean | null
          design_meeting_date: string | null
          documents_filed_date: string | null
          draft_sent_date: string | null
          drafts_approved_date: string | null
          engagement_envelope_id: string | null
          engagement_provider: string | null
          engagement_sent_at: string | null
          engagement_signed: boolean | null
          engagement_signed_at: string | null
          engagement_status: string | null
          ep_accounts_retitled: boolean | null
          ep_ancillary_docs: Json | null
          ep_anticipated_inheritance: boolean | null
          ep_beneficiary_updates_needed: boolean | null
          ep_deed_transfers_needed: boolean | null
          ep_funding_complete_date: string | null
          ep_funding_status: string | null
          ep_has_ilit: boolean | null
          ep_has_pets: boolean | null
          ep_has_prenuptial: boolean | null
          ep_has_real_estate: boolean | null
          ep_healthcare_proxy_status: string | null
          ep_hipaa_auth_status: string | null
          ep_ilit_trustee: string | null
          ep_living_will_status: string | null
          ep_ma_estate_tax_savings: number | null
          ep_ma_estate_taxable: boolean | null
          ep_plan_category: string | null
          ep_powers_of_attorney_status: string | null
          ep_prior_plan_date: string | null
          ep_prior_plan_firm: string | null
          ep_separate_trusts: boolean | null
          ep_signing_method: string | null
          ep_special_provisions: string | null
          ep_trust_type: string | null
          ep_witness_required: boolean | null
          est_estate_value: number | null
          execution_date: string | null
          fee_collected: boolean | null
          fee_collected_date: string | null
          fee_payment_status: string
          flat_fee_amount: number | null
          hired_date: string | null
          id: string
          intake_date: string | null
          internal_notes: string | null
          iolta_required: boolean | null
          jurisdiction_county: string | null
          jurisdiction_state: string | null
          lawmatics_id: string | null
          legal_plan: string | null
          legal_plan_id: string | null
          legal_plan_member_id: string | null
          legal_plan_service_end: string | null
          legal_plan_service_start: string | null
          legal_plan_type: string | null
          matter_number: string | null
          matter_status: string | null
          matter_status_notes: string | null
          matter_type: string | null
          next_action_date: string | null
          open_date: string | null
          paralegal_assigned: string | null
          payment_link_sent_at: string | null
          pb_706_due_date: string | null
          pb_706_filed_date: string | null
          pb_ancillary_probate_required: boolean | null
          pb_ancillary_probate_state: string | null
          pb_beneficiary_count: number | null
          pb_bond_amount: number | null
          pb_bond_waived_in_will: boolean | null
          pb_claims_period_end_date: string | null
          pb_court_name: string | null
          pb_date_of_death: string | null
          pb_decedent_name: string | null
          pb_docket_number: string | null
          pb_elective_share_claimed: boolean | null
          pb_estate_closed: boolean | null
          pb_estate_closed_date: string | null
          pb_estimated_close_date: string | null
          pb_federal_estate_tax_required: boolean | null
          pb_fiduciary_return_due_date: string | null
          pb_fiduciary_return_filed_date: string | null
          pb_final_distribution_date: string | null
          pb_has_minor_beneficiaries: boolean | null
          pb_heir_count: number | null
          pb_inventory_due_date: string | null
          pb_inventory_filed_date: string | null
          pb_m706_due_date: string | null
          pb_m706_filed_date: string | null
          pb_personal_representative: string | null
          pb_pr_appointment_date: string | null
          pb_probate_type: string | null
          pb_qualifies_small_estate: boolean | null
          pb_real_property_parcel_count: number | null
          pb_state_estate_tax_required: boolean | null
          pb_surviving_spouse: boolean | null
          pb_surviving_spouse_name: string | null
          pb_testate_intestate: string | null
          plan_type: string | null
          practice_area: string | null
          referral_source: string | null
          referral_source_other: string | null
          reimbursement_received_date: string | null
          responsible_attorney: string | null
          revisions_sent_date: string | null
          scheduled_signing_date: string | null
          signing_date: string | null
          target_close_date: string | null
          tax_exposure: string | null
          trust_funding_status: string | null
          trust_type: string | null
          updated_at: string
          urgency: string | null
          work_finished_date: string | null
          work_started_date: string | null
        }
        Insert: {
          billing_type?: string | null
          claim_amount?: number | null
          claim_submitted_date?: string | null
          client_id: string
          client_review_date?: string | null
          client_status?: string | null
          clio_matter_number?: string | null
          closed_date?: string | null
          closing_package_sent_date?: string | null
          co_counsel?: string | null
          conflict_check_completed?: boolean | null
          conflict_check_date?: string | null
          conflict_cleared?: boolean | null
          created_at?: string
          credit_shelter_provisions?: string | null
          deed_recorded?: boolean | null
          design_meeting_date?: string | null
          documents_filed_date?: string | null
          draft_sent_date?: string | null
          drafts_approved_date?: string | null
          engagement_envelope_id?: string | null
          engagement_provider?: string | null
          engagement_sent_at?: string | null
          engagement_signed?: boolean | null
          engagement_signed_at?: string | null
          engagement_status?: string | null
          ep_accounts_retitled?: boolean | null
          ep_ancillary_docs?: Json | null
          ep_anticipated_inheritance?: boolean | null
          ep_beneficiary_updates_needed?: boolean | null
          ep_deed_transfers_needed?: boolean | null
          ep_funding_complete_date?: string | null
          ep_funding_status?: string | null
          ep_has_ilit?: boolean | null
          ep_has_pets?: boolean | null
          ep_has_prenuptial?: boolean | null
          ep_has_real_estate?: boolean | null
          ep_healthcare_proxy_status?: string | null
          ep_hipaa_auth_status?: string | null
          ep_ilit_trustee?: string | null
          ep_living_will_status?: string | null
          ep_ma_estate_tax_savings?: number | null
          ep_ma_estate_taxable?: boolean | null
          ep_plan_category?: string | null
          ep_powers_of_attorney_status?: string | null
          ep_prior_plan_date?: string | null
          ep_prior_plan_firm?: string | null
          ep_separate_trusts?: boolean | null
          ep_signing_method?: string | null
          ep_special_provisions?: string | null
          ep_trust_type?: string | null
          ep_witness_required?: boolean | null
          est_estate_value?: number | null
          execution_date?: string | null
          fee_collected?: boolean | null
          fee_collected_date?: string | null
          fee_payment_status?: string
          flat_fee_amount?: number | null
          hired_date?: string | null
          id?: string
          intake_date?: string | null
          internal_notes?: string | null
          iolta_required?: boolean | null
          jurisdiction_county?: string | null
          jurisdiction_state?: string | null
          lawmatics_id?: string | null
          legal_plan?: string | null
          legal_plan_id?: string | null
          legal_plan_member_id?: string | null
          legal_plan_service_end?: string | null
          legal_plan_service_start?: string | null
          legal_plan_type?: string | null
          matter_number?: string | null
          matter_status?: string | null
          matter_status_notes?: string | null
          matter_type?: string | null
          next_action_date?: string | null
          open_date?: string | null
          paralegal_assigned?: string | null
          payment_link_sent_at?: string | null
          pb_706_due_date?: string | null
          pb_706_filed_date?: string | null
          pb_ancillary_probate_required?: boolean | null
          pb_ancillary_probate_state?: string | null
          pb_beneficiary_count?: number | null
          pb_bond_amount?: number | null
          pb_bond_waived_in_will?: boolean | null
          pb_claims_period_end_date?: string | null
          pb_court_name?: string | null
          pb_date_of_death?: string | null
          pb_decedent_name?: string | null
          pb_docket_number?: string | null
          pb_elective_share_claimed?: boolean | null
          pb_estate_closed?: boolean | null
          pb_estate_closed_date?: string | null
          pb_estimated_close_date?: string | null
          pb_federal_estate_tax_required?: boolean | null
          pb_fiduciary_return_due_date?: string | null
          pb_fiduciary_return_filed_date?: string | null
          pb_final_distribution_date?: string | null
          pb_has_minor_beneficiaries?: boolean | null
          pb_heir_count?: number | null
          pb_inventory_due_date?: string | null
          pb_inventory_filed_date?: string | null
          pb_m706_due_date?: string | null
          pb_m706_filed_date?: string | null
          pb_personal_representative?: string | null
          pb_pr_appointment_date?: string | null
          pb_probate_type?: string | null
          pb_qualifies_small_estate?: boolean | null
          pb_real_property_parcel_count?: number | null
          pb_state_estate_tax_required?: boolean | null
          pb_surviving_spouse?: boolean | null
          pb_surviving_spouse_name?: string | null
          pb_testate_intestate?: string | null
          plan_type?: string | null
          practice_area?: string | null
          referral_source?: string | null
          referral_source_other?: string | null
          reimbursement_received_date?: string | null
          responsible_attorney?: string | null
          revisions_sent_date?: string | null
          scheduled_signing_date?: string | null
          signing_date?: string | null
          target_close_date?: string | null
          tax_exposure?: string | null
          trust_funding_status?: string | null
          trust_type?: string | null
          updated_at?: string
          urgency?: string | null
          work_finished_date?: string | null
          work_started_date?: string | null
        }
        Update: {
          billing_type?: string | null
          claim_amount?: number | null
          claim_submitted_date?: string | null
          client_id?: string
          client_review_date?: string | null
          client_status?: string | null
          clio_matter_number?: string | null
          closed_date?: string | null
          closing_package_sent_date?: string | null
          co_counsel?: string | null
          conflict_check_completed?: boolean | null
          conflict_check_date?: string | null
          conflict_cleared?: boolean | null
          created_at?: string
          credit_shelter_provisions?: string | null
          deed_recorded?: boolean | null
          design_meeting_date?: string | null
          documents_filed_date?: string | null
          draft_sent_date?: string | null
          drafts_approved_date?: string | null
          engagement_envelope_id?: string | null
          engagement_provider?: string | null
          engagement_sent_at?: string | null
          engagement_signed?: boolean | null
          engagement_signed_at?: string | null
          engagement_status?: string | null
          ep_accounts_retitled?: boolean | null
          ep_ancillary_docs?: Json | null
          ep_anticipated_inheritance?: boolean | null
          ep_beneficiary_updates_needed?: boolean | null
          ep_deed_transfers_needed?: boolean | null
          ep_funding_complete_date?: string | null
          ep_funding_status?: string | null
          ep_has_ilit?: boolean | null
          ep_has_pets?: boolean | null
          ep_has_prenuptial?: boolean | null
          ep_has_real_estate?: boolean | null
          ep_healthcare_proxy_status?: string | null
          ep_hipaa_auth_status?: string | null
          ep_ilit_trustee?: string | null
          ep_living_will_status?: string | null
          ep_ma_estate_tax_savings?: number | null
          ep_ma_estate_taxable?: boolean | null
          ep_plan_category?: string | null
          ep_powers_of_attorney_status?: string | null
          ep_prior_plan_date?: string | null
          ep_prior_plan_firm?: string | null
          ep_separate_trusts?: boolean | null
          ep_signing_method?: string | null
          ep_special_provisions?: string | null
          ep_trust_type?: string | null
          ep_witness_required?: boolean | null
          est_estate_value?: number | null
          execution_date?: string | null
          fee_collected?: boolean | null
          fee_collected_date?: string | null
          fee_payment_status?: string
          flat_fee_amount?: number | null
          hired_date?: string | null
          id?: string
          intake_date?: string | null
          internal_notes?: string | null
          iolta_required?: boolean | null
          jurisdiction_county?: string | null
          jurisdiction_state?: string | null
          lawmatics_id?: string | null
          legal_plan?: string | null
          legal_plan_id?: string | null
          legal_plan_member_id?: string | null
          legal_plan_service_end?: string | null
          legal_plan_service_start?: string | null
          legal_plan_type?: string | null
          matter_number?: string | null
          matter_status?: string | null
          matter_status_notes?: string | null
          matter_type?: string | null
          next_action_date?: string | null
          open_date?: string | null
          paralegal_assigned?: string | null
          payment_link_sent_at?: string | null
          pb_706_due_date?: string | null
          pb_706_filed_date?: string | null
          pb_ancillary_probate_required?: boolean | null
          pb_ancillary_probate_state?: string | null
          pb_beneficiary_count?: number | null
          pb_bond_amount?: number | null
          pb_bond_waived_in_will?: boolean | null
          pb_claims_period_end_date?: string | null
          pb_court_name?: string | null
          pb_date_of_death?: string | null
          pb_decedent_name?: string | null
          pb_docket_number?: string | null
          pb_elective_share_claimed?: boolean | null
          pb_estate_closed?: boolean | null
          pb_estate_closed_date?: string | null
          pb_estimated_close_date?: string | null
          pb_federal_estate_tax_required?: boolean | null
          pb_fiduciary_return_due_date?: string | null
          pb_fiduciary_return_filed_date?: string | null
          pb_final_distribution_date?: string | null
          pb_has_minor_beneficiaries?: boolean | null
          pb_heir_count?: number | null
          pb_inventory_due_date?: string | null
          pb_inventory_filed_date?: string | null
          pb_m706_due_date?: string | null
          pb_m706_filed_date?: string | null
          pb_personal_representative?: string | null
          pb_pr_appointment_date?: string | null
          pb_probate_type?: string | null
          pb_qualifies_small_estate?: boolean | null
          pb_real_property_parcel_count?: number | null
          pb_state_estate_tax_required?: boolean | null
          pb_surviving_spouse?: boolean | null
          pb_surviving_spouse_name?: string | null
          pb_testate_intestate?: string | null
          plan_type?: string | null
          practice_area?: string | null
          referral_source?: string | null
          referral_source_other?: string | null
          reimbursement_received_date?: string | null
          responsible_attorney?: string | null
          revisions_sent_date?: string | null
          scheduled_signing_date?: string | null
          signing_date?: string | null
          target_close_date?: string | null
          tax_exposure?: string | null
          trust_funding_status?: string | null
          trust_type?: string | null
          updated_at?: string
          urgency?: string | null
          work_finished_date?: string | null
          work_started_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_document_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_document_folders_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_document_folders_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_document_folders_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_documents: {
        Row: {
          content_type: string
          created_at: string
          current_version_id: string | null
          draft_run_output: string | null
          folder_id: string | null
          generation_engine: string | null
          generation_id: string | null
          id: string
          marker_count: number | null
          matter_id: string
          missing_count: number | null
          name: string
          r2_key: string
          reviewed_at: string | null
          reviewed_by: string | null
          shared_at: string | null
          size: number
          source: string
          superseded_at: string | null
          template_id: string | null
          template_version_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string
          created_at?: string
          current_version_id?: string | null
          draft_run_output?: string | null
          folder_id?: string | null
          generation_engine?: string | null
          generation_id?: string | null
          id?: string
          marker_count?: number | null
          matter_id: string
          missing_count?: number | null
          name: string
          r2_key: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shared_at?: string | null
          size?: number
          source?: string
          superseded_at?: string | null
          template_id?: string | null
          template_version_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string
          current_version_id?: string | null
          draft_run_output?: string | null
          folder_id?: string | null
          generation_engine?: string | null
          generation_id?: string | null
          id?: string
          marker_count?: number | null
          matter_id?: string
          missing_count?: number | null
          name?: string
          r2_key?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shared_at?: string | null
          size?: number
          source?: string
          superseded_at?: string | null
          template_id?: string | null
          template_version_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_documents_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "matter_document_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_documents_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_estate_clause_overrides: {
        Row: {
          action: string | null
          clause_id: string
          created_at: string
          created_by: string
          event_type: string
          id: string
          matter_id: string
          publication_revision_id: string
          reason: string
          supersedes_override_id: string | null
        }
        Insert: {
          action?: string | null
          clause_id: string
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          matter_id: string
          publication_revision_id: string
          reason: string
          supersedes_override_id?: string | null
        }
        Update: {
          action?: string | null
          clause_id?: string
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          matter_id?: string
          publication_revision_id?: string
          reason?: string
          supersedes_override_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_estate_clause_override_publication_revision_id_clau_fkey"
            columns: ["publication_revision_id", "clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clause_revisions"
            referencedColumns: ["id", "clause_id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_clause_id_fkey"
            columns: ["clause_id"]
            isOneToOne: false
            referencedRelation: "estate_clauses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_estate_clause_overrides_supersedes_override_id_fkey"
            columns: ["supersedes_override_id"]
            isOneToOne: false
            referencedRelation: "matter_estate_clause_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_fee_milestones: {
        Row: {
          amount_cents: number
          billing_item_id: string | null
          created_at: string
          id: string
          label: string
          matter_id: string
          milestone_key: string
          position: number
          released_at: string | null
          schedule_id: string
          state: string
          terms: string
          trigger_key: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          billing_item_id?: string | null
          created_at?: string
          id?: string
          label: string
          matter_id: string
          milestone_key: string
          position: number
          released_at?: string | null
          schedule_id: string
          state?: string
          terms?: string
          trigger_key: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          billing_item_id?: string | null
          created_at?: string
          id?: string
          label?: string
          matter_id?: string
          milestone_key?: string
          position?: number
          released_at?: string | null
          schedule_id?: string
          state?: string
          terms?: string
          trigger_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_fee_milestones_billing_item_id_fkey"
            columns: ["billing_item_id"]
            isOneToOne: true
            referencedRelation: "billing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_fee_milestones_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_fee_milestones_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_fee_milestones_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_fee_milestones_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "matter_fee_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_fee_schedules: {
        Row: {
          agreed_total_cents: number
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          package_snapshot: Json
          service_package_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          agreed_total_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          package_snapshot: Json
          service_package_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          agreed_total_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          package_snapshot?: Json
          service_package_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_fee_schedules_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: true
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_fee_schedules_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: true
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_fee_schedules_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: true
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_fee_schedules_service_package_id_fkey"
            columns: ["service_package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_financial_exceptions: {
        Row: {
          documented_at: string
          documented_by: string
          id: string
          matter_id: string
          reason: string
          revoked_at: string | null
          status: string
        }
        Insert: {
          documented_at?: string
          documented_by: string
          id?: string
          matter_id: string
          reason: string
          revoked_at?: string | null
          status?: string
        }
        Update: {
          documented_at?: string
          documented_by?: string
          id?: string
          matter_id?: string
          reason?: string
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_financial_exceptions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_financial_exceptions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_financial_exceptions_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_notes: {
        Row: {
          author: string | null
          body: string
          calcom_booking_uid: string | null
          created_at: string
          id: string
          matter_id: string
          note_type: string
          source_lead_note_id: string | null
        }
        Insert: {
          author?: string | null
          body: string
          calcom_booking_uid?: string | null
          created_at?: string
          id?: string
          matter_id: string
          note_type?: string
          source_lead_note_id?: string | null
        }
        Update: {
          author?: string | null
          body?: string
          calcom_booking_uid?: string | null
          created_at?: string
          id?: string
          matter_id?: string
          note_type?: string
          source_lead_note_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_notes_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_notes_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_notes_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_notes_source_lead_note_id_fkey"
            columns: ["source_lead_note_id"]
            isOneToOne: false
            referencedRelation: "lead_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_relationship_status_history: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: number
          matter_id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          matter_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          matter_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_relationship_status_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_relationship_status_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_relationship_status_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_stage_history: {
        Row: {
          actor_id: string | null
          created_at: string
          entered_at: string
          from_stage: string | null
          id: number
          matter_id: string
          to_stage: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entered_at?: string
          from_stage?: string | null
          id?: number
          matter_id: string
          to_stage: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entered_at?: string
          from_stage?: string | null
          id?: number
          matter_id?: string
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      matter_stage_rules: {
        Row: {
          created_at: string
          description: string
          from_stage: string
          id: string
          is_active: boolean
          rule_key: string
          to_stage: string
        }
        Insert: {
          created_at?: string
          description: string
          from_stage: string
          id?: string
          is_active?: boolean
          rule_key: string
          to_stage: string
        }
        Update: {
          created_at?: string
          description?: string
          from_stage?: string
          id?: string
          is_active?: boolean
          rule_key?: string
          to_stage?: string
        }
        Relationships: []
      }
      matter_tasks: {
        Row: {
          assignee: string
          auto: boolean
          completed_at: string | null
          conditional: boolean
          created_at: string
          due_date: string | null
          due_offset_days: number | null
          escalation_date: string | null
          escalation_offset_days: number | null
          escalation_sent_at: string | null
          escalation_tier: string | null
          extends_target_days: number | null
          gate: string | null
          id: string
          matter_id: string
          name: string
          notes: string | null
          nudge_date: string | null
          nudge_offset_days: number | null
          nudge_sent_at: string | null
          nudge_tier: string | null
          paused_at: string | null
          pauses_clock: boolean
          phase: string
          pre_engagement: boolean
          recurring_interval_days: number | null
          relative_to: string | null
          skill: string | null
          skipped_at: string | null
          sort_order: number
          start_date: string
          status: string
          template_id: string | null
          total_paused_days: number
          triggers_day_zero: boolean
          updated_at: string
          variant: string | null
        }
        Insert: {
          assignee?: string
          auto?: boolean
          completed_at?: string | null
          conditional?: boolean
          created_at?: string
          due_date?: string | null
          due_offset_days?: number | null
          escalation_date?: string | null
          escalation_offset_days?: number | null
          escalation_sent_at?: string | null
          escalation_tier?: string | null
          extends_target_days?: number | null
          gate?: string | null
          id?: string
          matter_id: string
          name: string
          notes?: string | null
          nudge_date?: string | null
          nudge_offset_days?: number | null
          nudge_sent_at?: string | null
          nudge_tier?: string | null
          paused_at?: string | null
          pauses_clock?: boolean
          phase: string
          pre_engagement?: boolean
          recurring_interval_days?: number | null
          relative_to?: string | null
          skill?: string | null
          skipped_at?: string | null
          sort_order?: number
          start_date: string
          status?: string
          template_id?: string | null
          total_paused_days?: number
          triggers_day_zero?: boolean
          updated_at?: string
          variant?: string | null
        }
        Update: {
          assignee?: string
          auto?: boolean
          completed_at?: string | null
          conditional?: boolean
          created_at?: string
          due_date?: string | null
          due_offset_days?: number | null
          escalation_date?: string | null
          escalation_offset_days?: number | null
          escalation_sent_at?: string | null
          escalation_tier?: string | null
          extends_target_days?: number | null
          gate?: string | null
          id?: string
          matter_id?: string
          name?: string
          notes?: string | null
          nudge_date?: string | null
          nudge_offset_days?: number | null
          nudge_sent_at?: string | null
          nudge_tier?: string | null
          paused_at?: string | null
          pauses_clock?: boolean
          phase?: string
          pre_engagement?: boolean
          recurring_interval_days?: number | null
          relative_to?: string | null
          skill?: string | null
          skipped_at?: string | null
          sort_order?: number
          start_date?: string
          status?: string
          template_id?: string | null
          total_paused_days?: number
          triggers_day_zero?: boolean
          updated_at?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "sla_task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      matters: {
        Row: {
          client_id: string | null
          client_intake_id: string
          closed_at: string | null
          created_at: string
          creation_request_id: string | null
          declined_at: string | null
          declined_reason: string | null
          design_meeting_at: string | null
          discovery_call_at: string | null
          documents_executed_at: string | null
          drafts_sent_at: string | null
          engagement_signed_at: string | null
          fit_decided_at: string | null
          fit_decision: string | null
          flags: string[] | null
          hired_at: string | null
          hold_reason: string | null
          id: string
          intake_submitted_at: string | null
          li_design_sheet_approved: boolean | null
          li_design_sheet_data: Json | null
          li_plan_coverage: string | null
          lost_at: string | null
          lost_reason: string | null
          matter_number: string | null
          matter_number_manual: boolean
          matter_type: string | null
          name: string
          on_hold_at: string | null
          pmps_at: string | null
          portal_uploads_reviewed_at: string | null
          recommendations_sent_at: string | null
          relationship_status: string
          review_responded_at: string | null
          revision_round: number
          signing_date: string | null
          stage: string
          stage_entered_at: string | null
          status: string
          track: string
          unread_attorney_messages: number
          unread_client_messages: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_intake_id: string
          closed_at?: string | null
          created_at?: string
          creation_request_id?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          design_meeting_at?: string | null
          discovery_call_at?: string | null
          documents_executed_at?: string | null
          drafts_sent_at?: string | null
          engagement_signed_at?: string | null
          fit_decided_at?: string | null
          fit_decision?: string | null
          flags?: string[] | null
          hired_at?: string | null
          hold_reason?: string | null
          id?: string
          intake_submitted_at?: string | null
          li_design_sheet_approved?: boolean | null
          li_design_sheet_data?: Json | null
          li_plan_coverage?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          matter_number?: string | null
          matter_number_manual?: boolean
          matter_type?: string | null
          name?: string
          on_hold_at?: string | null
          pmps_at?: string | null
          portal_uploads_reviewed_at?: string | null
          recommendations_sent_at?: string | null
          relationship_status?: string
          review_responded_at?: string | null
          revision_round?: number
          signing_date?: string | null
          stage?: string
          stage_entered_at?: string | null
          status?: string
          track?: string
          unread_attorney_messages?: number
          unread_client_messages?: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_intake_id?: string
          closed_at?: string | null
          created_at?: string
          creation_request_id?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          design_meeting_at?: string | null
          discovery_call_at?: string | null
          documents_executed_at?: string | null
          drafts_sent_at?: string | null
          engagement_signed_at?: string | null
          fit_decided_at?: string | null
          fit_decision?: string | null
          flags?: string[] | null
          hired_at?: string | null
          hold_reason?: string | null
          id?: string
          intake_submitted_at?: string | null
          li_design_sheet_approved?: boolean | null
          li_design_sheet_data?: Json | null
          li_plan_coverage?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          matter_number?: string | null
          matter_number_manual?: boolean
          matter_type?: string | null
          name?: string
          on_hold_at?: string | null
          pmps_at?: string | null
          portal_uploads_reviewed_at?: string | null
          recommendations_sent_at?: string | null
          relationship_status?: string
          review_responded_at?: string | null
          revision_round?: number
          signing_date?: string | null
          stage?: string
          stage_entered_at?: string | null
          status?: string
          track?: string
          unread_attorney_messages?: number
          unread_client_messages?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matters_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matters_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          matter_id: string
          read_at: string | null
          sender_id: string | null
          sender_role: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          matter_id: string
          read_at?: string | null
          sender_id?: string | null
          sender_role: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          matter_id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_role?: string
        }
        Relationships: []
      }
      payment_receipts: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          payment_group_id: string
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          payment_group_id: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          payment_group_id?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_aging_snooze: {
        Row: {
          created_at: string
          entity: string
          entity_id: string
          id: number
          reason: string | null
          snoozed_by: string | null
          snoozed_until: string
          stage_key: string
        }
        Insert: {
          created_at?: string
          entity: string
          entity_id: string
          id?: never
          reason?: string | null
          snoozed_by?: string | null
          snoozed_until: string
          stage_key: string
        }
        Update: {
          created_at?: string
          entity?: string
          entity_id?: string
          id?: never
          reason?: string | null
          snoozed_by?: string | null
          snoozed_until?: string
          stage_key?: string
        }
        Relationships: []
      }
      prompt_publications: {
        Row: {
          prompt_id: string
          published_at: string
          published_by: string | null
          version_id: string
        }
        Insert: {
          prompt_id: string
          published_at?: string
          published_by?: string | null
          version_id: string
        }
        Update: {
          prompt_id?: string
          published_at?: string
          published_by?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_publications_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: true
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_publications_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_publications_version_id_prompt_id_fkey"
            columns: ["version_id", "prompt_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id", "prompt_id"]
          },
        ]
      }
      prompt_stage_triggers: {
        Row: {
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          matter_id: string
          on_field: string | null
          prompt_id: string
          reclaims: number
          run_id: string | null
          settled_at: string | null
          stage_entered_at: string
          status: string
          to_stage: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          matter_id: string
          on_field?: string | null
          prompt_id: string
          reclaims?: number
          run_id?: string | null
          settled_at?: string | null
          stage_entered_at: string
          status?: string
          to_stage?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          matter_id?: string
          on_field?: string | null
          prompt_id?: string
          reclaims?: number
          run_id?: string | null
          settled_at?: string | null
          stage_entered_at?: string
          status?: string
          to_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_stage_triggers_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_stage_triggers_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "prompt_stage_triggers_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "prompt_stage_triggers_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_stage_triggers_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          body: Json
          change_summary: string | null
          content_hash: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          prompt_id: string
          validation_status: string
          version_number: number
        }
        Insert: {
          body: Json
          change_summary?: string | null
          content_hash: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          prompt_id: string
          validation_status?: string
          version_number: number
        }
        Update: {
          body?: Json
          change_summary?: string | null
          content_hash?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          prompt_id?: string
          validation_status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_prompt_id_kind_fkey"
            columns: ["prompt_id", "kind"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id", "kind"]
          },
        ]
      }
      prompts: {
        Row: {
          created_at: string
          fires_on_field_change: string[]
          fires_on_stage_entry: string[]
          id: string
          is_system: boolean
          kind: string
          matter_types: string[]
          slug: string
          stages: string[]
          title: string
        }
        Insert: {
          created_at?: string
          fires_on_field_change?: string[]
          fires_on_stage_entry?: string[]
          id?: string
          is_system?: boolean
          kind: string
          matter_types?: string[]
          slug: string
          stages?: string[]
          title: string
        }
        Update: {
          created_at?: string
          fires_on_field_change?: string[]
          fires_on_stage_entry?: string[]
          id?: string
          is_system?: boolean
          kind?: string
          matter_types?: string[]
          slug?: string
          stages?: string[]
          title?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          key: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          key: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      scheduled_emails: {
        Row: {
          attempts: number
          bcc: string[]
          body_html: string
          body_text: string
          cancelled_at: string | null
          cc: string[]
          context_id: string | null
          context_type: string
          created_at: string
          document_ids: string[]
          email_log_id: string | null
          id: string
          include_signature: boolean
          last_error: string | null
          next_attempt_at: string
          processing_started_at: string | null
          provider_status: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          subject: string
          timezone: string
          to_email: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          bcc?: string[]
          body_html: string
          body_text: string
          cancelled_at?: string | null
          cc?: string[]
          context_id?: string | null
          context_type: string
          created_at?: string
          document_ids?: string[]
          email_log_id?: string | null
          id?: string
          include_signature?: boolean
          last_error?: string | null
          next_attempt_at?: string
          processing_started_at?: string | null
          provider_status?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          subject: string
          timezone?: string
          to_email: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          bcc?: string[]
          body_html?: string
          body_text?: string
          cancelled_at?: string | null
          cc?: string[]
          context_id?: string | null
          context_type?: string
          created_at?: string
          document_ids?: string[]
          email_log_id?: string | null
          id?: string
          include_signature?: boolean
          last_error?: string | null
          next_attempt_at?: string
          processing_started_at?: string | null
          provider_status?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string
          timezone?: string
          to_email?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduling_settings: {
        Row: {
          auto_intake_invite: boolean
          booking_paused: boolean
          buffer_minutes: number
          calendly_urls: Json
          date_overrides: Json
          horizon_days: number
          id: number
          min_notice_hours: number
          reminder_hours_before: number
          sms_reminders_enabled: boolean
          timezone: string
          updated_at: string
          updated_by: string | null
          weekly_hours: Json
        }
        Insert: {
          auto_intake_invite?: boolean
          booking_paused?: boolean
          buffer_minutes?: number
          calendly_urls?: Json
          date_overrides?: Json
          horizon_days?: number
          id?: number
          min_notice_hours?: number
          reminder_hours_before?: number
          sms_reminders_enabled?: boolean
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_hours?: Json
        }
        Update: {
          auto_intake_invite?: boolean
          booking_paused?: boolean
          buffer_minutes?: number
          calendly_urls?: Json
          date_overrides?: Json
          horizon_days?: number
          id?: number
          min_notice_hours?: number
          reminder_hours_before?: number
          sms_reminders_enabled?: boolean
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_hours?: Json
        }
        Relationships: []
      }
      service_package_milestones: {
        Row: {
          created_at: string
          id: string
          label: string
          milestone_key: string
          percentage_bps: number | null
          position: number
          service_package_id: string
          terms: string
          trigger_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          milestone_key: string
          percentage_bps?: number | null
          position: number
          service_package_id: string
          terms?: string
          trigger_key: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          milestone_key?: string
          percentage_bps?: number | null
          position?: number
          service_package_id?: string
          terms?: string
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_package_milestones_service_package_id_fkey"
            columns: ["service_package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      service_packages: {
        Row: {
          billing_strategy: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          practice_area: string
          scope_key: string
          updated_at: string
        }
        Insert: {
          billing_strategy: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          practice_area: string
          scope_key: string
          updated_at?: string
        }
        Update: {
          billing_strategy?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          practice_area?: string
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      signing_ceremonies: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          health_care_agent_name: string | null
          id: string
          location: string | null
          matter_id: string
          notary_name: string | null
          note: string | null
          scheduled_for: string | null
          status: string
          updated_at: string
          witness_one_name: string | null
          witness_two_name: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          health_care_agent_name?: string | null
          id?: string
          location?: string | null
          matter_id: string
          notary_name?: string | null
          note?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
          witness_one_name?: string | null
          witness_two_name?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          health_care_agent_name?: string | null
          id?: string
          location?: string | null
          matter_id?: string
          notary_name?: string | null
          note?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
          witness_one_name?: string | null
          witness_two_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signing_ceremonies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_ceremonies_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_ceremonies_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "signing_ceremonies_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      sla_task_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          target_days: number
          target_days_engagement: number | null
          target_days_pre_engagement: number | null
          tasks: Json
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          target_days: number
          target_days_engagement?: number | null
          target_days_pre_engagement?: number | null
          tasks?: Json
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          target_days?: number
          target_days_engagement?: number | null
          target_days_pre_engagement?: number | null
          tasks?: Json
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          body: string
          contact_id: string | null
          created_at: string
          direction: string
          error: string | null
          from_number: string | null
          id: string
          lead_id: string | null
          matter_id: string | null
          provider: string
          provider_message_id: string | null
          raw_payload: Json | null
          read_by_staff_at: string | null
          recipient_name: string | null
          recipient_role: string
          sent_at: string | null
          status: string
          to_number: string | null
          updated_at: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          body: string
          contact_id?: string | null
          created_at?: string
          direction: string
          error?: string | null
          from_number?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          provider?: string
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_by_staff_at?: string | null
          recipient_name?: string | null
          recipient_role?: string
          sent_at?: string | null
          status?: string
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          body?: string
          contact_id?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          from_number?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          provider?: string
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_by_staff_at?: string | null
          recipient_name?: string | null
          recipient_role?: string
          sent_at?: string | null
          status?: string
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_sla: {
        Row: {
          cumulative_sla_days: number | null
          entity: string
          escalation_offset: number | null
          owner: string
          sla_days: number | null
          stage_key: string
          stage_order: number
          track: string
        }
        Insert: {
          cumulative_sla_days?: number | null
          entity?: string
          escalation_offset?: number | null
          owner: string
          sla_days?: number | null
          stage_key: string
          stage_order: number
          track?: string
        }
        Update: {
          cumulative_sla_days?: number | null
          entity?: string
          escalation_offset?: number | null
          owner?: string
          sla_days?: number | null
          stage_key?: string
          stage_order?: number
          track?: string
        }
        Relationships: []
      }
      stage_tasks: {
        Row: {
          batch_tag: string | null
          checklist: Json
          created_at: string
          hard_due_at: string | null
          id: number
          matter_id: string
          soft_due_at: string | null
          stage_entered_at: string
          stage_key: string
          status: string
          task_type: string
          title: string
        }
        Insert: {
          batch_tag?: string | null
          checklist?: Json
          created_at?: string
          hard_due_at?: string | null
          id?: never
          matter_id: string
          soft_due_at?: string | null
          stage_entered_at: string
          stage_key: string
          status?: string
          task_type: string
          title: string
        }
        Update: {
          batch_tag?: string | null
          checklist?: Json
          created_at?: string
          hard_due_at?: string | null
          id?: never
          matter_id?: string
          soft_due_at?: string | null
          stage_entered_at?: string
          stage_key?: string
          status?: string
          task_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "stage_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      style_sets: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          settings: Json
          source_file_name: string | null
          source_r2_key: string | null
          source_size_bytes: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          settings?: Json
          source_file_name?: string | null
          source_r2_key?: string | null
          source_size_bytes?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          settings?: Json
          source_file_name?: string | null
          source_r2_key?: string | null
          source_size_bytes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "style_sets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tabular_cells: {
        Row: {
          citations: Json
          column_index: number
          content: string | null
          created_at: string
          document_id: string
          error_message: string | null
          id: string
          review_id: string
          status: string
          updated_at: string
        }
        Insert: {
          citations?: Json
          column_index: number
          content?: string | null
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: string
          review_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          citations?: Json
          column_index?: number
          content?: string | null
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: string
          review_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tabular_cells_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabular_cells_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "tabular_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      tabular_reviews: {
        Row: {
          columns_config: Json
          created_at: string
          created_by: string | null
          document_ids: Json
          id: string
          matter_id: string
          title: string
          updated_at: string
        }
        Insert: {
          columns_config?: Json
          created_at?: string
          created_by?: string | null
          document_ids?: Json
          id?: string
          matter_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          columns_config?: Json
          created_at?: string
          created_by?: string | null
          document_ids?: Json
          id?: string
          matter_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_templates: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          items: Json
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          items?: Json
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          items?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          auto: boolean
          batch_tag: string | null
          checklist: Json
          closeout_reason: string | null
          completed_at: string | null
          completed_by: string | null
          conditional: boolean
          created_at: string
          created_by: string | null
          description: string | null
          document_id: string | null
          due_at: string | null
          due_offset_days: number | null
          effective_due_at: string | null
          escalation_at: string | null
          escalation_offset_days: number | null
          escalation_sent_at: string | null
          escalation_tier: string | null
          estimate_minutes: number | null
          extends_target_days: number | null
          gate: string | null
          hard_due_at: string | null
          id: string
          lead_id: string | null
          matter_id: string | null
          notes: string | null
          nudge_at: string | null
          nudge_offset_days: number | null
          nudge_sent_at: string | null
          nudge_tier: string | null
          owner: string
          paused_at: string | null
          pauses_clock: boolean
          phase: string | null
          plan_start_date: string | null
          plan_template_id: string | null
          pre_engagement: boolean
          priority: string
          recurrence: Json | null
          recurring_interval_days: number | null
          relative_to: string | null
          remind_at: string | null
          skill: string | null
          skipped_at: string | null
          soft_due_at: string | null
          sort_order: number
          source: string
          stage_entered_at: string | null
          stage_key: string | null
          status: string
          task_type: string
          template_id: string | null
          title: string
          total_paused_days: number
          triggers_day_zero: boolean
          updated_at: string
          variant: string | null
        }
        Insert: {
          assignee_id?: string | null
          auto?: boolean
          batch_tag?: string | null
          checklist?: Json
          closeout_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          conditional?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          due_at?: string | null
          due_offset_days?: number | null
          effective_due_at?: string | null
          escalation_at?: string | null
          escalation_offset_days?: number | null
          escalation_sent_at?: string | null
          escalation_tier?: string | null
          estimate_minutes?: number | null
          extends_target_days?: number | null
          gate?: string | null
          hard_due_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          notes?: string | null
          nudge_at?: string | null
          nudge_offset_days?: number | null
          nudge_sent_at?: string | null
          nudge_tier?: string | null
          owner?: string
          paused_at?: string | null
          pauses_clock?: boolean
          phase?: string | null
          plan_start_date?: string | null
          plan_template_id?: string | null
          pre_engagement?: boolean
          priority?: string
          recurrence?: Json | null
          recurring_interval_days?: number | null
          relative_to?: string | null
          remind_at?: string | null
          skill?: string | null
          skipped_at?: string | null
          soft_due_at?: string | null
          sort_order?: number
          source?: string
          stage_entered_at?: string | null
          stage_key?: string | null
          status?: string
          task_type?: string
          template_id?: string | null
          title: string
          total_paused_days?: number
          triggers_day_zero?: boolean
          updated_at?: string
          variant?: string | null
        }
        Update: {
          assignee_id?: string | null
          auto?: boolean
          batch_tag?: string | null
          checklist?: Json
          closeout_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          conditional?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_id?: string | null
          due_at?: string | null
          due_offset_days?: number | null
          effective_due_at?: string | null
          escalation_at?: string | null
          escalation_offset_days?: number | null
          escalation_sent_at?: string | null
          escalation_tier?: string | null
          estimate_minutes?: number | null
          extends_target_days?: number | null
          gate?: string | null
          hard_due_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          notes?: string | null
          nudge_at?: string | null
          nudge_offset_days?: number | null
          nudge_sent_at?: string | null
          nudge_tier?: string | null
          owner?: string
          paused_at?: string | null
          pauses_clock?: boolean
          phase?: string | null
          plan_start_date?: string | null
          plan_template_id?: string | null
          pre_engagement?: boolean
          priority?: string
          recurrence?: Json | null
          recurring_interval_days?: number | null
          relative_to?: string | null
          remind_at?: string | null
          skill?: string | null
          skipped_at?: string | null
          soft_due_at?: string | null
          sort_order?: number
          source?: string
          stage_entered_at?: string | null
          stage_key?: string | null
          status?: string
          task_type?: string
          template_id?: string | null
          title?: string
          total_paused_days?: number
          triggers_day_zero?: boolean
          updated_at?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "tasks_plan_template_id_fkey"
            columns: ["plan_template_id"]
            isOneToOne: false
            referencedRelation: "sla_task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_webhook_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          occurred_at: string | null
          payload: Json
          processed_at: string
          provider: string
          provider_event_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string | null
          payload?: Json
          processed_at?: string
          provider: string
          provider_event_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string | null
          payload?: Json
          processed_at?: string
          provider?: string
          provider_event_id?: string
        }
        Relationships: []
      }
      template_builder_uploads: {
        Row: {
          byte_size: number
          created_at: string
          created_by: string | null
          filename: string
          id: string
          original_storage_path: string
          revision: number
          sha256: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          original_storage_path: string
          revision?: number
          sha256: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          original_storage_path?: string
          revision?: number
          sha256?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_builder_uploads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_keys: {
        Row: {
          auth_tag: string
          created_at: string
          encrypted_key: string
          id: string
          iv: string
          key_hint: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_tag: string
          created_at?: string
          encrypted_key: string
          id?: string
          iv: string
          key_hint?: string | null
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_tag?: string
          created_at?: string
          encrypted_key?: string
          id?: string
          iv?: string
          key_hint?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_mcp_connectors: {
        Row: {
          auth_config_iv: string | null
          auth_config_tag: string | null
          auth_mode: string
          created_at: string
          enabled: boolean
          encrypted_auth_config: string | null
          id: string
          name: string
          server_url: string
          tool_policy: Json
          transport: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_config_iv?: string | null
          auth_config_tag?: string | null
          auth_mode?: string
          created_at?: string
          enabled?: boolean
          encrypted_auth_config?: string | null
          id?: string
          name: string
          server_url: string
          tool_policy?: Json
          transport?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_config_iv?: string | null
          auth_config_tag?: string | null
          auth_mode?: string
          created_at?: string
          enabled?: boolean
          encrypted_auth_config?: string | null
          id?: string
          name?: string
          server_url?: string
          tool_policy?: Json
          transport?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_mcp_oauth_tokens: {
        Row: {
          access_token_iv: string | null
          access_token_tag: string | null
          connector_id: string
          created_at: string
          encrypted_access_token: string | null
          encrypted_refresh_token: string | null
          expires_at: string | null
          id: string
          refresh_token_iv: string | null
          refresh_token_tag: string | null
          scope: string | null
          token_type: string | null
          updated_at: string
        }
        Insert: {
          access_token_iv?: string | null
          access_token_tag?: string | null
          connector_id: string
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          refresh_token_iv?: string | null
          refresh_token_tag?: string | null
          scope?: string | null
          token_type?: string | null
          updated_at?: string
        }
        Update: {
          access_token_iv?: string | null
          access_token_tag?: string | null
          connector_id?: string
          created_at?: string
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          expires_at?: string | null
          id?: string
          refresh_token_iv?: string | null
          refresh_token_tag?: string | null
          scope?: string | null
          token_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_mcp_oauth_tokens_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: true
            referencedRelation: "user_mcp_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          preferences: Json
          role: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          preferences?: Json
          role?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          preferences?: Json
          role?: string
        }
        Relationships: []
      }
      work_run_artifacts: {
        Row: {
          artifact_kind: string
          content_type: string
          created_at: string
          filename: string
          id: string
          promoted_at: string | null
          promoted_document_id: string | null
          promotion_status: string
          r2_key: string
          run_id: string
          sha256: string
          size_bytes: number
        }
        Insert: {
          artifact_kind: string
          content_type: string
          created_at?: string
          filename: string
          id?: string
          promoted_at?: string | null
          promoted_document_id?: string | null
          promotion_status?: string
          r2_key: string
          run_id: string
          sha256: string
          size_bytes?: number
        }
        Update: {
          artifact_kind?: string
          content_type?: string
          created_at?: string
          filename?: string
          id?: string
          promoted_at?: string | null
          promoted_document_id?: string | null
          promotion_status?: string
          r2_key?: string
          run_id?: string
          sha256?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_run_artifacts_promoted_document_id_fkey"
            columns: ["promoted_document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_run_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "work_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      work_runs: {
        Row: {
          confirmation_state: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          execution_mode: string
          id: string
          input_snapshot: Json
          matter_id: string | null
          output_text: string | null
          skill_id: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmation_state?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          execution_mode: string
          id?: string
          input_snapshot?: Json
          matter_id?: string | null
          output_text?: string | null
          skill_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmation_state?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          execution_mode?: string
          id?: string
          input_snapshot?: Json
          matter_id?: string | null
          output_text?: string | null
          skill_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_runs_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "work_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      work_skill_revisions: {
        Row: {
          created_at: string
          edited_by: string | null
          id: string
          name: string
          skill_id: string
          skill_md: string
          version: string
        }
        Insert: {
          created_at?: string
          edited_by?: string | null
          id?: string
          name: string
          skill_id: string
          skill_md: string
          version: string
        }
        Update: {
          created_at?: string
          edited_by?: string | null
          id?: string
          name?: string
          skill_id?: string
          skill_md?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_skill_revisions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "work_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      work_skill_shares: {
        Row: {
          allow_edit: boolean
          created_at: string
          created_by: string | null
          id: string
          shared_with_email: string
          skill_id: string
        }
        Insert: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          shared_with_email: string
          skill_id: string
        }
        Update: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          shared_with_email?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_skill_shares_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "work_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      work_skills: {
        Row: {
          allowed_context: string[]
          columns_config: Json | null
          created_at: string
          description: string
          execution_mode: string
          id: string
          is_active: boolean
          is_system: boolean
          jurisdictions: string[]
          name: string
          owner_id: string | null
          practice: string | null
          skill_md: string
          skill_type: string
          slug: string | null
          sort_order: number | null
          source: string
          updated_at: string
          version: string
        }
        Insert: {
          allowed_context?: string[]
          columns_config?: Json | null
          created_at?: string
          description: string
          execution_mode?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          jurisdictions?: string[]
          name: string
          owner_id?: string | null
          practice?: string | null
          skill_md: string
          skill_type?: string
          slug?: string | null
          sort_order?: number | null
          source?: string
          updated_at?: string
          version?: string
        }
        Update: {
          allowed_context?: string[]
          columns_config?: Json | null
          created_at?: string
          description?: string
          execution_mode?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          jurisdictions?: string[]
          name?: string
          owner_id?: string | null
          practice?: string | null
          skill_md?: string
          skill_type?: string
          slug?: string | null
          sort_order?: number | null
          source?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      workflow_citations: {
        Row: {
          bbox: Json | null
          block_index: number
          char_end: number
          char_start: number
          created_at: string
          document_version_id: string
          finding_id: string | null
          id: string
          page: number | null
          quote: string
          text_layer_id: string
          verification: string
        }
        Insert: {
          bbox?: Json | null
          block_index: number
          char_end: number
          char_start: number
          created_at?: string
          document_version_id: string
          finding_id?: string | null
          id?: string
          page?: number | null
          quote: string
          text_layer_id: string
          verification?: string
        }
        Update: {
          bbox?: Json | null
          block_index?: number
          char_end?: number
          char_start?: number
          created_at?: string
          document_version_id?: string
          finding_id?: string | null
          id?: string
          page?: number | null
          quote?: string
          text_layer_id?: string
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_citations_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_citations_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "workflow_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_citations_text_layer_id_fkey"
            columns: ["text_layer_id"]
            isOneToOne: false
            referencedRelation: "document_text_layers"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_field_references: {
        Row: {
          actual_value: string | null
          claimed_value: string | null
          created_at: string
          field_key: string
          finding_id: string
          id: string
          matched_path: string | null
          verification: string
        }
        Insert: {
          actual_value?: string | null
          claimed_value?: string | null
          created_at?: string
          field_key: string
          finding_id: string
          id?: string
          matched_path?: string | null
          verification: string
        }
        Update: {
          actual_value?: string | null
          claimed_value?: string | null
          created_at?: string
          field_key?: string
          finding_id?: string
          id?: string
          matched_path?: string | null
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_field_references_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "workflow_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_findings: {
        Row: {
          attempted_quote: string | null
          citation_refusal: string | null
          created_at: string
          disposition: string
          disposition_at: string | null
          disposition_by: string | null
          disposition_note: string | null
          id: string
          outcome: string
          proposed_language: string | null
          rationale: string
          rule_number: string
          run_id: string
          severity: string | null
        }
        Insert: {
          attempted_quote?: string | null
          citation_refusal?: string | null
          created_at?: string
          disposition?: string
          disposition_at?: string | null
          disposition_by?: string | null
          disposition_note?: string | null
          id?: string
          outcome: string
          proposed_language?: string | null
          rationale?: string
          rule_number: string
          run_id: string
          severity?: string | null
        }
        Update: {
          attempted_quote?: string | null
          citation_refusal?: string | null
          created_at?: string
          disposition?: string
          disposition_at?: string | null
          disposition_by?: string | null
          disposition_note?: string | null
          id?: string
          outcome?: string
          proposed_language?: string | null
          rationale?: string
          rule_number?: string
          run_id?: string
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_findings_disposition_by_fkey"
            columns: ["disposition_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_jobs: {
        Row: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          id?: string
          job_type: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          matter_id?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          id?: string
          job_type?: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          matter_id?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_jobs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_jobs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "workflow_jobs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      workflow_run_steps: {
        Row: {
          attempts: number
          finding_id: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          run_id: string
          sequence: number
          started_at: string | null
          status: string
          unit_id: string
        }
        Insert: {
          attempts?: number
          finding_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          run_id: string
          sequence: number
          started_at?: string | null
          status: string
          unit_id: string
        }
        Update: {
          attempts?: number
          finding_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          run_id?: string
          sequence?: number
          started_at?: string | null
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_run_steps_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "workflow_findings"
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
          created_by: string | null
          document_version_id: string | null
          failed_count: number
          failures: Json
          finding_count: number
          finished_at: string | null
          id: string
          kind: string
          last_tick_at: string | null
          locked_by: string | null
          matter_id: string
          model: string | null
          prompt_version_id: string | null
          reclaims: number
          render_version: number | null
          resolved_inputs: Json | null
          rule_total: number
          started_at: string
          status: string
          text_layer_id: string | null
        }
        Insert: {
          created_by?: string | null
          document_version_id?: string | null
          failed_count?: number
          failures?: Json
          finding_count?: number
          finished_at?: string | null
          id?: string
          kind?: string
          last_tick_at?: string | null
          locked_by?: string | null
          matter_id: string
          model?: string | null
          prompt_version_id?: string | null
          reclaims?: number
          render_version?: number | null
          resolved_inputs?: Json | null
          rule_total?: number
          started_at?: string
          status: string
          text_layer_id?: string | null
        }
        Update: {
          created_by?: string | null
          document_version_id?: string | null
          failed_count?: number
          failures?: Json
          finding_count?: number
          finished_at?: string | null
          id?: string
          kind?: string
          last_tick_at?: string | null
          locked_by?: string | null
          matter_id?: string
          model?: string | null
          prompt_version_id?: string | null
          reclaims?: number
          render_version?: number | null
          resolved_inputs?: Json | null
          rule_total?: number
          started_at?: string
          status?: string
          text_layer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "workflow_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "workflow_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_text_layer_id_fkey"
            columns: ["text_layer_id"]
            isOneToOne: false
            referencedRelation: "document_text_layers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contact_merge_candidates: {
        Row: {
          email: string | null
          loser_contact_id: string | null
          loser_first_name: string | null
          loser_last_name: string | null
          loser_matter_count: number | null
          names_match: boolean | null
          winner_contact_id: string | null
          winner_first_name: string | null
          winner_last_name: string | null
          winner_matter_count: number | null
        }
        Relationships: []
      }
      v_communication_threads: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          channels: string[] | null
          contact_email: string | null
          contact_id: string | null
          contact_phone: string | null
          display_name: string | null
          last_channel: string | null
          last_direction: string | null
          last_message_at: string | null
          last_preview: string | null
          lead_id: string | null
          marked_unread_at: string | null
          matter_id: string | null
          matter_number: string | null
          record_type: string | null
          snoozed_until: string | null
          stage: string | null
          thread_key: string | null
          unread_count: number | null
          waiting_since: string | null
        }
        Relationships: []
      }
      v_cornerstone_crm_parity: {
        Row: {
          crm_count: number | null
          entity: string | null
          source_count: number | null
        }
        Relationships: []
      }
      v_cornerstone_crm_people: {
        Row: {
          assigned_to_user_id: string | null
          city: string | null
          client_intake_id: string | null
          company_name: string | null
          contact_id: string | null
          cornerstone_matter_id: string | null
          country: string | null
          created_at: string | null
          duplicate_review_status: string | null
          email: string | null
          first_name: string | null
          id: string | null
          last_engagement_at: string | null
          last_name: string | null
          lead_id: string | null
          lead_source: string | null
          lifecycle_status: string | null
          matter_id: string | null
          name: string | null
          next_follow_up_at: string | null
          owner_user_id: string | null
          person_kind: string | null
          phone: string | null
          practice_area: string | null
          record_status: string | null
          referral_source: string | null
          related_intake_id: string | null
          relationship_label: string | null
          relationship_type: string | null
          stage_id: string | null
          stage_name: string | null
          stage_slug: string | null
          state: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["cornerstone_matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "contacts_client_intake_id_fkey"
            columns: ["related_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_client_intake_id_fkey"
            columns: ["related_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["loser_contact_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_merge_candidates"
            referencedColumns: ["winner_contact_id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cornerstone_crm_people_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "cornerstone_crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      v_lead_list: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          awaiting_intake: boolean | null
          billing_type: string | null
          city: string | null
          client_user_id: string | null
          county: string | null
          created_at: string | null
          date_of_birth: string | null
          display_name: string | null
          email: string | null
          engagement_fee_quoted: number | null
          engagement_pending: boolean | null
          engagement_sent_at: string | null
          engagement_signed_at: string | null
          engagement_status: string | null
          first_name: string | null
          full_name: string | null
          has_minor_children: boolean | null
          has_pending_agreement: boolean | null
          id: string | null
          intake_complete: boolean | null
          intake_completed_at: string | null
          intake_sent_at: string | null
          is_open: boolean | null
          last_activity_at: string | null
          last_name: string | null
          lead_next_action_snoozed_until: string | null
          lead_source: string | null
          lead_status: string | null
          lead_urgency: string | null
          marital_status: string | null
          matter_id: string | null
          middle_name: string | null
          needs_attention: boolean | null
          next_appointment_at: string | null
          phone: string | null
          practice_area: string | null
          preferred_name: string | null
          qualification_notes: string | null
          score: number | null
          state: string | null
          status: string | null
          taxable_estate: number | null
          updated_at: string | null
          user_id: string | null
          zip: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "client_intake_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
        ]
      }
      v_matter_aging: {
        Row: {
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          cumulative_days: number | null
          cumulative_sla_days: number | null
          current_stage: string | null
          days_in_stage: number | null
          days_over_sla: number | null
          entity: string | null
          escalation_offset: number | null
          health: string | null
          id: string | null
          is_cumulative_overdue: boolean | null
          is_overdue: boolean | null
          is_scheduled: boolean | null
          is_snoozed: boolean | null
          needs_outreach: boolean | null
          owner: string | null
          raw_health: string | null
          sla_days: number | null
          snooze_id: number | null
          snooze_reason: string | null
          snoozed_until: string | null
          stage_clock_suspect: boolean | null
          stage_entered_at: string | null
          stage_order: number | null
          stage_visits: number | null
          track: string | null
        }
        Relationships: []
      }
      v_matter_pipeline: {
        Row: {
          client_address: string | null
          client_dob: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          client_status: string | null
          design_status: string | null
          documents_executed_at: string | null
          drafts_sent_at: string | null
          fee_amount: number | null
          flags: string[] | null
          has_minor_children: boolean | null
          intake_sent_at: string | null
          intake_status: string | null
          intake_submitted_at: string | null
          marital_status: string | null
          matter_created: string | null
          matter_id: string | null
          matter_name: string | null
          next_appointment: string | null
          next_appointment_type: string | null
          opened_at: string | null
          plan_type: string | null
          practice_area: string | null
          referral_source: string | null
          signing_date: string | null
          spouse_address: string | null
          spouse_dob: string | null
          spouse_email: string | null
          spouse_name: string | null
          spouse_phone: string | null
          stage: string | null
          status: string | null
          taxable_estate: number | null
        }
        Relationships: []
      }
      v_matter_pipeline_all: {
        Row: {
          client_address: string | null
          client_dob: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          client_status: string | null
          design_status: string | null
          documents_executed_at: string | null
          drafts_sent_at: string | null
          fee_amount: number | null
          flags: string[] | null
          has_minor_children: boolean | null
          intake_sent_at: string | null
          intake_status: string | null
          intake_submitted_at: string | null
          marital_status: string | null
          matter_created: string | null
          matter_id: string | null
          matter_name: string | null
          matter_number: string | null
          next_appointment: string | null
          next_appointment_type: string | null
          opened_at: string | null
          plan_type: string | null
          practice_area: string | null
          referral_source: string | null
          relationship_status: string | null
          signing_date: string | null
          spouse_address: string | null
          spouse_dob: string | null
          spouse_email: string | null
          spouse_name: string | null
          spouse_phone: string | null
          stage: string | null
          status: string | null
          taxable_estate: number | null
        }
        Relationships: []
      }
      v_matter_stage_totals: {
        Row: {
          business_days: number | null
          client_intake_id: string | null
          first_entered_at: string | null
          last_entered_at: string | null
          matter_id: string | null
          stage: string | null
          visits: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matter_stage_history_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "v_matter_pipeline_all"
            referencedColumns: ["matter_id"]
          },
          {
            foreignKeyName: "matters_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "client_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matters_client_intake_id_fkey"
            columns: ["client_intake_id"]
            isOneToOne: false
            referencedRelation: "v_lead_list"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pipeline_aging: {
        Row: {
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          cumulative_days: number | null
          cumulative_sla_days: number | null
          current_stage: string | null
          days_in_stage: number | null
          days_over_sla: number | null
          entity: string | null
          escalation_offset: number | null
          health: string | null
          id: string | null
          is_cumulative_overdue: boolean | null
          is_overdue: boolean | null
          is_scheduled: boolean | null
          is_snoozed: boolean | null
          needs_outreach: boolean | null
          owner: string | null
          raw_health: string | null
          sla_days: number | null
          snooze_id: number | null
          snooze_reason: string | null
          snoozed_until: string | null
          stage_clock_suspect: boolean | null
          stage_entered_at: string | null
          stage_order: number | null
          stage_visits: number | null
          track: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_integration_entity_lease: {
        Args: { p_entity_id: string; p_entity_type: string; p_provider: string }
        Returns: string
      }
      approve_invoice_reminder: {
        Args: { p_actor_id: string; p_reminder_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          body: string
          cadence_week: string
          created_at: string
          escalation_level: string
          id: string
          invoice_id: string
          recipient_email: string
          sent_at: string | null
          status: string
          subject: string
          suppressed_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_reminders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_billing_actor: { Args: { p_actor_id: string }; Returns: undefined }
      assert_lead_note_actor: { Args: { p_actor_id: string }; Returns: string }
      attach_invoice_documents: {
        Args: {
          p_actor_id: string
          p_docx_document_id: string
          p_invoice_id: string
          p_pdf_document_id: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      business_days_elapsed: {
        Args: { p_end?: string; p_start: string }
        Returns: number
      }
      cancel_document_template_version: {
        Args: {
          p_actor_id: string
          p_template_id: string
          p_version_id: string
        }
        Returns: Json
      }
      claim_crm_campaign_deliveries: {
        Args: { p_campaign_id: string; p_limit: number }
        Returns: {
          id: string
        }[]
      }
      claim_draft_generation_run: {
        Args: {
          p_actor_id: string
          p_documents: string[]
          p_id: string
          p_matter_id: string
          p_request_hash: string
          p_revision: string
          p_worker_token: string
        }
        Returns: Json
      }
      claim_engagement_agreement_resume: {
        Args: {
          p_agreement_id: string
          p_firma_request_id: string
          p_sent_by: string
        }
        Returns: {
          active_revision_id: string | null
          approval_nonce: string | null
          completed_at: string | null
          completed_r2_key: string | null
          created_at: string
          external_request_id: string | null
          firma_request_id: string | null
          id: string
          last_provider_sync_at: string | null
          lead_id: string | null
          legacy_envelope_id: string | null
          matter_id: string | null
          prepared_by: string | null
          provider: string
          provider_sync_error: string | null
          provider_sync_error_at: string | null
          send_lease_expires_at: string | null
          send_lease_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "engagement_agreements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_engagement_agreement_send: {
        Args: {
          p_agreement_id: string
          p_approval_nonce: string
          p_render_sha256: string
          p_revision_id: string
          p_sent_by: string
        }
        Returns: {
          active_revision_id: string | null
          approval_nonce: string | null
          completed_at: string | null
          completed_r2_key: string | null
          created_at: string
          external_request_id: string | null
          firma_request_id: string | null
          id: string
          last_provider_sync_at: string | null
          lead_id: string | null
          legacy_envelope_id: string | null
          matter_id: string | null
          prepared_by: string | null
          provider: string
          provider_sync_error: string | null
          provider_sync_error_at: string | null
          send_lease_expires_at: string | null
          send_lease_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "engagement_agreements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_esign_webhook_event: {
        Args: {
          p_agreement_id: string
          p_event_id: string
          p_event_type: string
          p_external_request_id: string
          p_payload: Json
          p_provider: string
        }
        Returns: string
      }
      claim_firma_webhook_event: {
        Args: {
          p_agreement_id: string
          p_event_id: string
          p_event_type: string
          p_firma_request_id: string
          p_payload: Json
        }
        Returns: string
      }
      claim_prompt_stage_trigger: {
        Args: { p_worker: string }
        Returns: {
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          matter_id: string
          on_field: string | null
          prompt_id: string
          reclaims: number
          run_id: string | null
          settled_at: string | null
          stage_entered_at: string
          status: string
          to_stage: string | null
        }
        SetofOptions: {
          from: "*"
          to: "prompt_stage_triggers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_occurred_at?: string
          p_payload?: Json
          p_provider: string
        }
        Returns: boolean
      }
      claim_workflow_jobs: {
        Args: { p_limit: number; p_worker: string }
        Returns: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workflow_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_workflow_jobs_v2: {
        Args: { p_lease_seconds?: number; p_limit: number; p_worker: string }
        Returns: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workflow_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_workflow_run: {
        Args: { p_worker: string }
        Returns: {
          created_by: string | null
          document_version_id: string | null
          failed_count: number
          failures: Json
          finding_count: number
          finished_at: string | null
          id: string
          kind: string
          last_tick_at: string | null
          locked_by: string | null
          matter_id: string
          model: string | null
          prompt_version_id: string | null
          reclaims: number
          render_version: number | null
          resolved_inputs: Json | null
          rule_total: number
          started_at: string
          status: string
          text_layer_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "workflow_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_invoice_checkout_session: {
        Args: { p_provider: string; p_session_id: string; p_status: string }
        Returns: undefined
      }
      complete_invoice_checkout_session: {
        Args: {
          p_amount_cents: number
          p_payment_intent_id: string
          p_processor_fee_cents: number
          p_provider: string
          p_received_at: string
          p_session_id: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_lead_to_matter: {
        Args: {
          p_actor_id?: string
          p_client_id: string
          p_engagement_envelope_id: string
          p_engagement_provider: string
          p_engagement_sent_at: string
          p_engagement_signed: boolean
          p_engagement_signed_at: string
          p_engagement_status: string
          p_fee: number
          p_lead_id: string
          p_matter_name: string
          p_matter_number: string
          p_practice_area: string
        }
        Returns: {
          created: boolean
          matter_id: string
          matter_number: string
        }[]
      }
      correct_matter: {
        Args: {
          p_expect: Json
          p_matter_id: string
          p_reason: string
          p_set: Json
        }
        Returns: {
          client_id: string | null
          client_intake_id: string
          closed_at: string | null
          created_at: string
          creation_request_id: string | null
          declined_at: string | null
          declined_reason: string | null
          design_meeting_at: string | null
          discovery_call_at: string | null
          documents_executed_at: string | null
          drafts_sent_at: string | null
          engagement_signed_at: string | null
          fit_decided_at: string | null
          fit_decision: string | null
          flags: string[] | null
          hired_at: string | null
          hold_reason: string | null
          id: string
          intake_submitted_at: string | null
          li_design_sheet_approved: boolean | null
          li_design_sheet_data: Json | null
          li_plan_coverage: string | null
          lost_at: string | null
          lost_reason: string | null
          matter_number: string | null
          matter_number_manual: boolean
          matter_type: string | null
          name: string
          on_hold_at: string | null
          pmps_at: string | null
          portal_uploads_reviewed_at: string | null
          recommendations_sent_at: string | null
          relationship_status: string
          review_responded_at: string | null
          revision_round: number
          signing_date: string | null
          stage: string
          stage_entered_at: string | null
          status: string
          track: string
          unread_attorney_messages: number
          unread_client_messages: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "matters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_billing_item: {
        Args: {
          p_actor_id: string
          p_amount_billed: number
          p_kind: string
          p_label: string
          p_matter_id: string
          p_plan: string
        }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_engagement_agreement_revision: {
        Args: {
          p_agreement_id: string
          p_html_r2_key?: string
          p_input_snapshot: Json
          p_master_version: string
          p_pdf_r2_key?: string
          p_render_sha256: string
          p_render_snapshot: Json
        }
        Returns: {
          agreement_id: string
          created_at: string
          html_r2_key: string | null
          id: string
          input_snapshot: Json
          master_version: string
          pdf_r2_key: string | null
          render_sha256: string
          render_snapshot: Json
          revision_number: number
        }[]
        SetofOptions: {
          from: "*"
          to: "engagement_agreement_revisions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_invoice_draft: {
        Args: {
          p_actor_id: string
          p_bill_to_email: string
          p_bill_to_name: string
          p_due_date: string
          p_issue_date: string
          p_item_ids: string[]
          p_matter_id: string
          p_notes: string
          p_payment_link: string
          p_terms: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_lead_meeting_note_with_activity: {
        Args: {
          p_actor_id: string
          p_attendees: string[]
          p_body: string
          p_lead_id: string
          p_meeting_date: string
          p_title: string
        }
        Returns: {
          actor_id: string
          attendees: string[]
          body: string
          created_at: string
          granola_note_id: string | null
          id: string
          lead_id: string
          meeting_date: string
          source: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lead_meeting_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_lead_note_with_activity: {
        Args: { p_actor_id: string; p_body: string; p_lead_id: string }
        Returns: {
          actor_id: string
          body: string
          created_at: string
          id: string
          lead_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lead_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_matter_fee_schedule: {
        Args: {
          p_actor_id: string
          p_agreed_total_cents: number
          p_manual_milestones?: Json
          p_matter_id: string
          p_package_id: string
        }
        Returns: {
          agreed_total_cents: number
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          package_snapshot: Json
          service_package_id: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "matter_fee_schedules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_matter_with_client: {
        Args: {
          p_actor_id?: string
          p_client_email: string
          p_client_name: string
          p_client_phone: string
          p_client_user_id?: string
          p_first_name: string
          p_last_name: string
          p_matter_name: string
          p_matter_number: string
          p_practice_area: string
          p_request_id?: string
        }
        Returns: {
          client_intake_id: string
          created: boolean
          matter_id: string
          matter_number: string
        }[]
      }
      crm_current_user_is_staff: {
        Args: { p_admin_only?: boolean }
        Returns: boolean
      }
      crm_stage_slug_for_intake: {
        Args: {
          p_discovery_call_at?: string
          p_engagement_sent_at: string
          p_engagement_status: string
          p_intake_completed_at: string
          p_intake_sent_at: string
          p_intake_status: string
          p_lead_status: string
          p_pmps_at?: string
          p_relationship_status: string
        }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_billing_items: {
        Args: { p_actor_id: string; p_item_ids: string[] }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_intake_contact: {
        Args: { p_client_intake_id: string; p_contact_id: string }
        Returns: number
      }
      delete_lead_note_with_activity: {
        Args: { p_actor_id: string; p_lead_id: string; p_note_id: string }
        Returns: undefined
      }
      delete_matter_contact: {
        Args: { p_contact_id: string; p_matter_id: string }
        Returns: number
      }
      discard_invoice_draft: {
        Args: { p_actor_id: string; p_invoice_id: string }
        Returns: undefined
      }
      document_matter_financial_exception: {
        Args: { p_actor_id: string; p_matter_id: string; p_reason: string }
        Returns: {
          documented_at: string
          documented_by: string
          id: string
          matter_id: string
          reason: string
          revoked_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "matter_financial_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      draft_generation_metrics: { Args: { p_matter_id: string }; Returns: Json }
      drafting_hub_draft_rollups: {
        Args: { p_matter_ids: string[] }
        Returns: {
          current_draft_count: number
          matter_id: string
          recent_drafts: Json
          superseded_draft_count: number
        }[]
      }
      drafting_hub_has_documents: {
        Args: { p_decisions: Json; p_plan: string }
        Returns: boolean
      }
      drafting_hub_page: {
        Args: {
          p_action?: string
          p_page?: number
          p_page_size?: number
          p_practice?: string
          p_search?: string
          p_sort?: string
        }
        Returns: Json
      }
      enqueue_workflow_job: {
        Args: {
          p_actor_id: string
          p_dedupe_key: string
          p_job_type: string
          p_matter_id: string
          p_payload: Json
        }
        Returns: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workflow_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_user_profile: {
        Args: { p_display_name?: string }
        Returns: string
      }
      finish_workflow_job: {
        Args: { p_error?: string; p_job_id: string }
        Returns: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workflow_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_workflow_job_v2: {
        Args: { p_claim_token: string; p_error?: string; p_job_id: string }
        Returns: boolean
      }
      finish_workflow_job_v3: {
        Args: {
          p_claim_token: string
          p_error?: string
          p_job_id: string
          p_retry_after_ms?: number
        }
        Returns: boolean
      }
      firm_billing_matter_options_v1: {
        Args: { p_search: string; p_selected?: string }
        Returns: Json
      }
      firm_lead_summary_v1: { Args: never; Returns: Json }
      firm_ledger_page_v1: { Args: { p_query: Json }; Returns: Json }
      firm_matter_page_v1: { Args: { p_query: Json }; Returns: Json }
      firm_task_page_v1: { Args: { p_query: Json }; Returns: Json }
      get_matter_links_by_emails: {
        Args: { p_emails: string[] }
        Returns: {
          doc_counts: Json
          email: string
          matter_id: string
          matter_name: string
          stage: string
        }[]
      }
      import_lead_granola_note_with_activity: {
        Args: {
          p_actor_id: string
          p_attendees: string[]
          p_body: string
          p_granola_note_id: string
          p_lead_id: string
          p_meeting_date: string
          p_title: string
        }
        Returns: {
          imported: boolean
          meeting_note: Database["public"]["Tables"]["lead_meeting_notes"]["Row"]
        }[]
      }
      is_contact_channel_list: { Args: { value: Json }; Returns: boolean }
      issue_invoice: {
        Args: { p_actor_id: string; p_invoice_id: string }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_invoice_credit_note: {
        Args: {
          p_actor_id: string
          p_amount_cents: number
          p_invoice_id: string
          p_reason: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      jsonb_replace_id: {
        Args: { doc: Json; from_id: string; to_id: string }
        Returns: Json
      }
      lead_score: {
        Args: {
          p_billing_type: string
          p_engagement_sent_at: string
          p_engagement_signed_at: string
          p_engagement_status: string
          p_fee_quoted: number
          p_has_minor_children: boolean
          p_intake_completed_at: string
          p_intake_sent_at: string
          p_intake_status: string
          p_last_touch_at: string
          p_lead_source: string
          p_next_appointment_at: string
          p_taxable_estate: number
          p_urgency: string
        }
        Returns: number
      }
      lead_scoring_appointment_at: {
        Args: { p_discovery_call_at: string; p_pmps_at: string }
        Returns: string
      }
      legal_plan_display_name: {
        Args: { p_billing_type: string }
        Returns: string
      }
      load_estate_clause_generation_snapshot: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      map_matter_stage_to_engine: { Args: { p_stage: string }; Returns: string }
      mark_billing_item_invoiced: {
        Args: { p_actor_id: string; p_item_id: string }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_billing_reminder_sent: {
        Args: { p_actor_id: string; p_item_id: string }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_engagement_agreement_ready: {
        Args: {
          p_agreement_id: string
          p_render_sha256: string
          p_revision_id: string
        }
        Returns: {
          active_revision_id: string | null
          approval_nonce: string | null
          completed_at: string | null
          completed_r2_key: string | null
          created_at: string
          external_request_id: string | null
          firma_request_id: string | null
          id: string
          last_provider_sync_at: string | null
          lead_id: string | null
          legacy_envelope_id: string | null
          matter_id: string | null
          prepared_by: string | null
          provider: string
          provider_sync_error: string | null
          provider_sync_error_at: string | null
          send_lease_expires_at: string | null
          send_lease_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "engagement_agreements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_invoice_reminder_sent: {
        Args: { p_actor_id: string; p_invoice_id: string }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_invoice_sent: {
        Args: {
          p_actor_id: string
          p_channel: string
          p_invoice_id: string
          p_recipient: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_messages_read: {
        Args: { p_matter_id: string; p_reader_role: string }
        Returns: undefined
      }
      merge_contacts: {
        Args: {
          p_actor_id?: string
          p_loser_id: string
          p_reason?: string
          p_winner_id: string
        }
        Returns: {
          design_sheets_rewritten: number
          matter_links_moved: number
          messages_moved: number
          roles_moved: number
        }[]
      }
      next_invoice_number: { Args: { p_year: number }; Returns: string }
      normalize_us_phone: { Args: { value: string }; Returns: string }
      open_matter_for_person: {
        Args: {
          p_actor_id?: string
          p_carry_household?: boolean
          p_client_user_id?: string
          p_contact_id: string
          p_extra_contact_ids?: string[]
          p_matter_name: string
          p_matter_number: string
          p_practice_area: string
          p_request_id?: string
        }
        Returns: {
          client_intake_id: string
          created: boolean
          matter_id: string
          matter_number: string
        }[]
      }
      persist_generated_estate_document: {
        Args: { p_document: Json; p_manifest: Json }
        Returns: Json
      }
      pipeline_stage_rank: { Args: { p_stage: string }; Returns: number }
      publish_document_template_version: {
        Args: {
          p_actor_id: string
          p_confirmation: string
          p_event_type?: string
          p_expected_active_version_id: string
          p_template_id: string
          p_version_id: string
        }
        Returns: Json
      }
      publish_estate_clause_revision: {
        Args: {
          p_actor_id: string
          p_current_template_snapshot_hash: string
          p_expected_current_revision_id: string
          p_revision_id: string
        }
        Returns: Json
      }
      rate_limit_consume: {
        Args: { p_bucket: string; p_key: string; p_window_seconds: number }
        Returns: number
      }
      record_billing_payment: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_item_id: string
          p_method: string
          p_note: string
          p_received_at: string
        }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_estate_clause_preview: {
        Args: {
          p_actor_id: string
          p_dependency_revision_ids: Json
          p_document_types: string[]
          p_representative_matter_id: string
          p_revision_id: string
          p_template_snapshot_hash: string
          p_validation_report: Json
        }
        Returns: string
      }
      record_invoice_checkout_session: {
        Args: {
          p_actor_id: string
          p_amount_cents: number
          p_checkout_url: string
          p_expires_at: string
          p_invoice_id: string
          p_provider: string
          p_session_id: string
        }
        Returns: {
          amount_cents: number
          checkout_url: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          invoice_id: string
          payment_group_id: string | null
          provider: string
          provider_payment_intent_id: string | null
          provider_session_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice_checkout_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_invoice_payment: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_external_reference?: string
          p_invoice_id: string
          p_method: string
          p_note: string
          p_processor_fee_cents?: number
          p_received_at: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_payment_adjustment: {
        Args: {
          p_actor_id?: string
          p_amount_cents: number
          p_balance_effect: string
          p_external_reference: string
          p_invoice_id: string
          p_kind: string
          p_metadata: Json
          p_payment_group_id: string
          p_provider: string
          p_reason: string
        }
        Returns: {
          amount_cents: number
          balance_effect: string
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          invoice_id: string
          kind: string
          metadata: Json
          payment_group_id: string | null
          provider: string | null
          reason: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "billing_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_integration_entity_lease: {
        Args: { p_entity_id: string; p_entity_type: string; p_lease_token: string; p_provider: string }
        Returns: boolean
      }
      release_matter_fee_milestone: {
        Args: { p_actor_id: string; p_milestone_id: string }
        Returns: {
          amount_cents: number
          billing_item_id: string | null
          created_at: string
          id: string
          label: string
          matter_id: string
          milestone_key: string
          position: number
          released_at: string | null
          schedule_id: string
          state: string
          terms: string
          trigger_key: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "matter_fee_milestones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_matter_fee_milestone_internal: {
        Args: { p_actor_id?: string; p_milestone_id: string }
        Returns: {
          amount_cents: number
          billing_item_id: string | null
          created_at: string
          id: string
          label: string
          matter_id: string
          milestone_key: string
          position: number
          released_at: string | null
          schedule_id: string
          state: string
          terms: string
          trigger_key: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "matter_fee_milestones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_integration_workflow_job: {
        Args: { p_dedupe_key: string; p_job_type: string }
        Returns: string
      }
      release_webhook_event: {
        Args: { p_event_id: string; p_provider: string }
        Returns: undefined
      }
      request_estate_clause_changes: {
        Args: { p_actor_id: string; p_comment: string; p_revision_id: string }
        Returns: string
      }
      retire_estate_clause_publication: {
        Args: {
          p_actor_id: string
          p_clause_id: string
          p_expected_current_revision_id: string
          p_reason: string
        }
        Returns: string
      }
      retire_matter_estate_clause_override: {
        Args: {
          p_actor_id: string
          p_clause_id: string
          p_matter_id: string
          p_reason: string
        }
        Returns: Json
      }
      retry_workflow_job: {
        Args: { p_actor_id: string; p_job_id: string }
        Returns: {
          attempts: number
          available_at: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          matter_id: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workflow_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revert_estate_clause_publication: {
        Args: {
          p_actor_id: string
          p_clause_id: string
          p_current_template_snapshot_hash: string
          p_expected_current_revision_id: string
          p_reason: string
          p_target_revision_id: string
        }
        Returns: string
      }
      self_contact_for_intake: {
        Args: { p_intake_id: string }
        Returns: string
      }
      snooze_lead_next_action: {
        Args: { p_actor_id: string; p_lead_id: string; p_until: string }
        Returns: Json
      }
      submit_estate_clause_revision: {
        Args: { p_actor_id: string; p_working_draft_id: string }
        Returns: string
      }
      transition_matter_stage_with_jobs: {
        Args: {
          p_actor_email: string
          p_actor_id: string
          p_actor_name: string
          p_matter_id: string
          p_stage: string
          p_stage_label: string
        }
        Returns: Json
      }
      transition_matter_status_with_closeout: {
        Args: {
          p_actor_email: string
          p_actor_id: string
          p_actor_name: string
          p_hold_reason: string
          p_matter_id: string
          p_status: string
          p_status_label: string
        }
        Returns: Json
      }
      update_billing_item: {
        Args: {
          p_actor_id: string
          p_amount_billed: number
          p_item_id: string
          p_kind: string
          p_label: string
          p_plan: string
        }
        Returns: {
          amount_billed: number
          created_at: string
          created_by: string | null
          id: string
          incurred_at: string | null
          invoice_id: string | null
          invoiced_at: string | null
          kind: string
          label: string
          last_reminded_at: string | null
          matter_id: string
          plan: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "billing_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_invoice_draft: {
        Args: {
          p_actor_id: string
          p_bill_to_email: string
          p_bill_to_name: string
          p_due_date: string
          p_invoice_id: string
          p_issue_date: string
          p_item_ids: string[]
          p_notes: string
          p_payment_link: string
          p_terms: string
        }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead_details: {
        Args: {
          p_actor_id: string
          p_details: Json
          p_lead_id: string
          p_spouse: Json
        }
        Returns: {
          additional_contacts: Json | null
          additional_emails: Json
          additional_phones: Json
          address_line1: string | null
          address_line2: string | null
          attorney_review_flags: Json
          billing_type: string | null
          citizenship: string | null
          citizenship_status: string | null
          city: string | null
          client_user_id: string | null
          college_prep_details: Json | null
          county: string | null
          created_at: string
          current_step: string | null
          date_of_birth: string | null
          date_of_marriage: string | null
          document_inclusions: Json | null
          email: string | null
          employer: string | null
          engagement_envelope_id: string | null
          engagement_fee_quoted: number | null
          engagement_provider: string | null
          engagement_sent_at: string | null
          engagement_signed_at: string | null
          engagement_status: string | null
          estate_value: string | null
          excluded_guardian: string | null
          excluded_guardian_2: string | null
          family_details: Json | null
          fiduciary_entries: Json | null
          financial_details: Json | null
          first_name: string | null
          full_name: string | null
          goals: Json | null
          has_business: boolean | null
          has_children: boolean | null
          has_divorce_settlement: boolean | null
          has_existing_plan: boolean | null
          has_family_disability: boolean | null
          has_hcp: boolean | null
          has_investments: boolean | null
          has_life_insurance: boolean | null
          has_ltc_insurance: boolean | null
          has_major_illness: boolean | null
          has_minor_children: boolean | null
          has_poa: boolean | null
          has_prior_gift_tax: boolean | null
          has_real_property: boolean | null
          has_retirement: boolean | null
          has_trust: boolean | null
          has_will: boolean | null
          id: string
          intake_completed_at: string | null
          intake_invite_token: string | null
          intake_link_created_at: string | null
          intake_link_revoked_at: string | null
          intake_link_version: string | null
          intake_sent_at: string | null
          intake_token_expires_at: string | null
          intake_token_hash: string | null
          intake_token_last_used_at: string | null
          intake_track: string
          is_trust_beneficiary: boolean | null
          is_us_citizen: boolean | null
          last_name: string | null
          lawmatics_matter_id: string | null
          lead_next_action_snoozed_until: string | null
          lead_source: string | null
          lead_status: string | null
          lead_urgency: string | null
          legal_plan_member_id: string | null
          legal_plan_service_end: string | null
          legal_plan_service_start: string | null
          marital_status: string | null
          marriage_date: string | null
          matter_id: string | null
          middle_name: string | null
          notes: string | null
          occupation: string | null
          other_individuals: Json | null
          phone: string | null
          plan_type: string | null
          planning_goals: string[] | null
          planning_objectives: string | null
          practice_area: string | null
          preferred_name: string | null
          preferred_pronoun: string | null
          prior_marriage: boolean | null
          prior_names: string | null
          probate_details: Json | null
          qualification_notes: string | null
          referral_source: string | null
          review_choices: Json | null
          special_circumstances: string[] | null
          special_notes: string | null
          spouse_as_fiduciary: boolean | null
          state: string | null
          status: string
          suffix: string | null
          taxable_estate: number | null
          unlock_request_note: string | null
          unlock_requested_at: string | null
          updated_at: string
          uploads_reviewed_at: string | null
          user_id: string | null
          zip: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_intake"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead_note_with_activity: {
        Args: {
          p_actor_id: string
          p_body: string
          p_lead_id: string
          p_note_id: string
        }
        Returns: {
          actor_id: string
          body: string
          created_at: string
          id: string
          lead_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lead_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead_opportunity_details: {
        Args: {
          p_actor_id: string
          p_details: Json
          p_lead_id: string
          p_spouse: Json
        }
        Returns: {
          additional_contacts: Json | null
          additional_emails: Json
          additional_phones: Json
          address_line1: string | null
          address_line2: string | null
          attorney_review_flags: Json
          billing_type: string | null
          citizenship: string | null
          citizenship_status: string | null
          city: string | null
          client_user_id: string | null
          college_prep_details: Json | null
          county: string | null
          created_at: string
          current_step: string | null
          date_of_birth: string | null
          date_of_marriage: string | null
          document_inclusions: Json | null
          email: string | null
          employer: string | null
          engagement_envelope_id: string | null
          engagement_fee_quoted: number | null
          engagement_provider: string | null
          engagement_sent_at: string | null
          engagement_signed_at: string | null
          engagement_status: string | null
          estate_value: string | null
          excluded_guardian: string | null
          excluded_guardian_2: string | null
          family_details: Json | null
          fiduciary_entries: Json | null
          financial_details: Json | null
          first_name: string | null
          full_name: string | null
          goals: Json | null
          has_business: boolean | null
          has_children: boolean | null
          has_divorce_settlement: boolean | null
          has_existing_plan: boolean | null
          has_family_disability: boolean | null
          has_hcp: boolean | null
          has_investments: boolean | null
          has_life_insurance: boolean | null
          has_ltc_insurance: boolean | null
          has_major_illness: boolean | null
          has_minor_children: boolean | null
          has_poa: boolean | null
          has_prior_gift_tax: boolean | null
          has_real_property: boolean | null
          has_retirement: boolean | null
          has_trust: boolean | null
          has_will: boolean | null
          id: string
          intake_completed_at: string | null
          intake_invite_token: string | null
          intake_link_created_at: string | null
          intake_link_revoked_at: string | null
          intake_link_version: string | null
          intake_sent_at: string | null
          intake_token_expires_at: string | null
          intake_token_hash: string | null
          intake_token_last_used_at: string | null
          intake_track: string
          is_trust_beneficiary: boolean | null
          is_us_citizen: boolean | null
          last_name: string | null
          lawmatics_matter_id: string | null
          lead_next_action_snoozed_until: string | null
          lead_source: string | null
          lead_status: string | null
          lead_urgency: string | null
          legal_plan_member_id: string | null
          legal_plan_service_end: string | null
          legal_plan_service_start: string | null
          marital_status: string | null
          marriage_date: string | null
          matter_id: string | null
          middle_name: string | null
          notes: string | null
          occupation: string | null
          other_individuals: Json | null
          phone: string | null
          plan_type: string | null
          planning_goals: string[] | null
          planning_objectives: string | null
          practice_area: string | null
          preferred_name: string | null
          preferred_pronoun: string | null
          prior_marriage: boolean | null
          prior_names: string | null
          probate_details: Json | null
          qualification_notes: string | null
          referral_source: string | null
          review_choices: Json | null
          special_circumstances: string[] | null
          special_notes: string | null
          spouse_as_fiduciary: boolean | null
          state: string | null
          status: string
          suffix: string | null
          taxable_estate: number | null
          unlock_request_note: string | null
          unlock_requested_at: string | null
          updated_at: string
          uploads_reviewed_at: string | null
          user_id: string | null
          zip: string | null
        }
        SetofOptions: {
          from: "*"
          to: "client_intake"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead_opportunity_field: {
        Args: {
          p_actor_id: string
          p_field: string
          p_lead_id: string
          p_value: Json
        }
        Returns: Json
      }
      update_lead_opportunity_status: {
        Args: { p_actor_id: string; p_lead_id: string; p_status: string }
        Returns: Json
      }
      upsert_matter_estate_clause_override: {
        Args: {
          p_action: string
          p_actor_id: string
          p_clause_id: string
          p_expected_current_revision_id: string
          p_matter_id: string
          p_reason: string
        }
        Returns: Json
      }
      upsert_retell_call: {
        Args: { p_call: Json }
        Returns: {
          conflict: boolean
          previous_summary: string
        }[]
      }
      void_invoice: {
        Args: { p_actor_id: string; p_invoice_id: string; p_reason: string }
        Returns: {
          bill_to_email: string | null
          bill_to_name: string | null
          created_at: string
          created_by: string | null
          credit_of_invoice_id: string | null
          docx_document_id: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          issued_at: string | null
          kind: string
          last_reminded_at: string | null
          matter_id: string
          notes: string | null
          number: string | null
          number_year: number | null
          paid_at: string | null
          payment_link: string | null
          pdf_document_id: string | null
          sent_at: string | null
          status: string
          subtotal_cents: number
          terms: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
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
    Enums: {},
  },
} as const
