import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://dxdtgyxvbzomatuzorxn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4ZHRneXh2YnpvbWF0dXpvcnhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwMTYxNjEsImV4cCI6MjA4NjU5MjE2MX0.OQaqG8kOga1Oupcqna8iJpbaIwi3ImRzbUD6jlxYIF8'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)