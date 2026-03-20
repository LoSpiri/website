/**
 * Build script for the RAG chatbot knowledge base.
 * 
 * Extracts content from:
 *   1. All HTML pages in the website
 *   2. GitHub repos (via API) + their READMEs
 * 
 * Outputs:
 *   - chatbot/knowledge.json  (chunked text with metadata)
 *   - chatbot/orama-index.json (serialized Orama index with embeddings)
 * 
 * Usage: node chatbot/build-index.js
 */

import { create, insert, save } from '@orama/orama';
import { JSDOM } from 'jsdom';
import { pipeline } from '@xenova/transformers';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const GITHUB_USER = 'LoSpiri';
const SITE_ROOT = resolve(import.meta.dirname, '..');
const CHUNK_SIZE = 200; // ~200 words per chunk
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim, ~23MB

// ---------------------------------------------------------------------------
// 1. Extract text from HTML files
// ---------------------------------------------------------------------------

function extractTextFromHTML(filePath) {
  const html = readFileSync(filePath, 'utf-8');
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Remove script, style, header, footer, nav
  doc.querySelectorAll('script, style, site-header, site-footer, nav, header, footer')
    .forEach(el => el.remove());

  const sections = [];
  const title = doc.querySelector('title')?.textContent?.replace(' — Lorenzo Spiridioni', '') || '';

  // Extract by section
  doc.querySelectorAll('section, article').forEach(el => {
    const heading = el.querySelector('h2, h3')?.textContent?.trim() || '';
    const text = el.textContent
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 20) {
      sections.push({
        source: filePath.split(/[/\\]/).pop(),
        page: title,
        section: heading,
        text,
      });
    }
  });

  // Fallback: if no sections found, extract all main text
  if (sections.length === 0) {
    const mainText = doc.querySelector('main')?.textContent?.replace(/\s+/g, ' ').trim();
    if (mainText && mainText.length > 20) {
      sections.push({
        source: filePath.split(/[/\\]/).pop(),
        page: title,
        section: '',
        text: mainText,
      });
    }
  }

  return sections;
}

function getAllHTMLFiles() {
  const htmlFiles = readdirSync(SITE_ROOT)
    .filter(f => f.endsWith('.html'))
    .map(f => join(SITE_ROOT, f));
  return htmlFiles;
}

// ---------------------------------------------------------------------------
// 2. Fetch GitHub repos + READMEs
// ---------------------------------------------------------------------------

async function fetchGitHubData() {
  const chunks = [];

  try {
    console.log('  Fetching GitHub repos...');
    const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100`);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const repos = await res.json();

    for (const repo of repos) {
      // Build a description chunk for each repo
      const parts = [
        `GitHub project: ${repo.name}`,
        repo.description ? `Description: ${repo.description}` : '',
        repo.language ? `Primary language: ${repo.language}` : '',
        repo.topics?.length ? `Topics: ${repo.topics.join(', ')}` : '',
        `Stars: ${repo.stargazers_count}, Forks: ${repo.forks_count}`,
        `Created: ${new Date(repo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}`,
        `Last updated: ${new Date(repo.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}`,
        `URL: ${repo.html_url}`,
      ].filter(Boolean);

      chunks.push({
        source: 'github',
        page: 'GitHub Projects',
        section: repo.name,
        text: parts.join('. '),
      });

      // Try to fetch README
      try {
        const readmeRes = await fetch(
          `https://api.github.com/repos/${GITHUB_USER}/${repo.name}/readme`,
          { headers: { Accept: 'application/vnd.github.raw' } }
        );
        if (readmeRes.ok) {
          let readme = await readmeRes.text();
          // Strip markdown formatting
          readme = readme
            .replace(/!\[.*?\]\(.*?\)/g, '')     // images
            .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links -> text
            .replace(/#{1,6}\s*/g, '')             // headings
            .replace(/[*_~`]/g, '')                // formatting
            .replace(/\n{3,}/g, '\n\n')            // excessive newlines
            .trim();

          if (readme.length > 50) {
            chunks.push({
              source: 'github',
              page: 'GitHub Projects',
              section: `${repo.name} README`,
              text: readme.slice(0, 1500), // Cap README length
            });
          }
        }
      } catch {
        // README not available, skip
      }
    }
  } catch (err) {
    console.warn('  ⚠ Could not fetch GitHub data:', err.message);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// 3. Chunk text into ~CHUNK_SIZE word segments
// ---------------------------------------------------------------------------

function chunkText(items) {
  const chunks = [];
  let globalIdx = 0;

  for (const item of items) {
    const words = item.text.split(/\s+/);

    if (words.length <= CHUNK_SIZE) {
      chunks.push({ ...item, id: `chunk_${globalIdx++}` });
    } else {
      // Sliding window with 20% overlap
      const step = Math.floor(CHUNK_SIZE * 0.8);
      let idx = 0;

      while (idx < words.length) {
        const slice = words.slice(idx, idx + CHUNK_SIZE);
        chunks.push({
          ...item,
          text: slice.join(' '),
          id: `chunk_${globalIdx++}`,
        });
        idx += step;
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// 4. Generate embeddings
// ---------------------------------------------------------------------------

async function generateEmbeddings(chunks) {
  console.log(`  Generating embeddings for ${chunks.length} chunks...`);
  const embedder = await pipeline('feature-extraction', EMBEDDING_MODEL);

  const embeddings = [];
  for (let i = 0; i < chunks.length; i++) {
    const output = await embedder(chunks[i].text, { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(output.data));

    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      process.stdout.write(`\r  Embedded ${i + 1}/${chunks.length}`);
    }
  }
  console.log('');

  return embeddings;
}

// ---------------------------------------------------------------------------
// 5. Build Orama index
// ---------------------------------------------------------------------------

async function buildOramaIndex(chunks, embeddings) {
  console.log('  Building Orama index...');

  const db = create({
    schema: {
      id: 'string',
      source: 'string',
      page: 'string',
      section: 'string',
      text: 'string',
      embedding: 'vector[384]',
    },
  });

  for (let i = 0; i < chunks.length; i++) {
    insert(db, {
      id: chunks[i].id,
      source: chunks[i].source,
      page: chunks[i].page,
      section: chunks[i].section,
      text: chunks[i].text,
      embedding: embeddings[i],
    });
  }

  return db;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔨 Building chatbot knowledge base...\n');

  // Step 1: Extract HTML content
  console.log('📄 Extracting website content...');
  const htmlFiles = getAllHTMLFiles();
  let allItems = [];
  for (const file of htmlFiles) {
    const items = extractTextFromHTML(file);
    allItems.push(...items);
    console.log(`  ${file.split(/[/\\]/).pop()}: ${items.length} sections`);
  }

  // Step 2: Fetch GitHub data
  console.log('\n🐙 Fetching GitHub data...');
  const githubItems = await fetchGitHubData();
  allItems.push(...githubItems);
  console.log(`  ${githubItems.length} GitHub entries`);

  // Step 3: Chunk text
  console.log('\n✂️  Chunking text...');
  const chunks = chunkText(allItems);
  console.log(`  ${chunks.length} chunks created`);

  // Step 4: Generate embeddings
  console.log('\n🧠 Generating embeddings...');
  const embeddings = await generateEmbeddings(chunks);

  // Step 5: Build Orama index
  console.log('\n📦 Building Orama index...');
  const db = await buildOramaIndex(chunks, embeddings);

  // Step 6: Save outputs
  const outDir = resolve(import.meta.dirname);

  // Save knowledge base (for debugging/inspection)
  const knowledgePath = join(outDir, 'knowledge.json');
  writeFileSync(knowledgePath, JSON.stringify(chunks, null, 2));
  console.log(`\n✅ Knowledge base saved: ${knowledgePath}`);

  // Save Orama index
  const indexData = save(db);
  const indexPath = join(outDir, 'orama-index.json');
  writeFileSync(indexPath, JSON.stringify(indexData));
  console.log(`✅ Orama index saved: ${indexPath}`);

  // Save embeddings separately (for vector search at runtime)
  const embeddingsPath = join(outDir, 'embeddings.json');
  writeFileSync(embeddingsPath, JSON.stringify(embeddings));
  console.log(`✅ Embeddings saved: ${embeddingsPath}`);

  console.log(`\n🎉 Done! ${chunks.length} chunks indexed.`);
}

main().catch(console.error);
