
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPaths() {
    console.log('--- FOLDERS ---');
    const { data: folders, error: fError } = await supabase.from('folders').select('*');
    if (fError) console.error(fError);
    else console.log(folders);

    console.log('\n--- SINTEL MOVIE ---');
    const { data: movies, error: mError } = await supabase.from('movies').select('file_path, file_name, official_title').ilike('file_name', '%sintel%');
    if (mError) console.error(mError);
    else console.log(movies);
}

checkPaths();
