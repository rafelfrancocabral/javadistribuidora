// ============================================================
// Java Distribuidora - Configuracao do Supabase
// ============================================================

const SUPABASE_URL = 'https://herdcwkduntkdbigrkfl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlcmRjd2tkdW50a2RiaWdya2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2MzgzNjcsImV4cCI6MjA4MzIxNDM2N30.YKMnOS6_rlhVS1188FT8YrjBk986Io_od1VbG24Crck';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SUPABASE_PRODUCTS_TABLE = 'produtos';
const SUPABASE_CATEGORIES_TABLE = 'categorias';
const SUPABASE_SUBCATEGORIES_TABLE = 'subcategorias';
const SUPABASE_QUOTES_TABLE = 'orcamentos';
const SUPABASE_CLIENTS_TABLE = 'clientes';
const SUPABASE_STORAGE_BUCKET = 'produtos';