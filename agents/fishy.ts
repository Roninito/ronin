import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { DatabaseAPI } from "../src/api/database.js";

/**
 * Fishy Agent
 * 
 * This agent creates and maintains a comprehensive database of North American fish species
 * and provides a web interface for browsing the database.
 * 
 * It:
 * 1. Generates a list of North American fish species using AI
 * 2. Creates a SQL database schema for fish profiles
 * 3. Processes fish data (name, binomial, aliases, lifecycle, habitats, habits, fishing tips)
 * 4. Tracks processing status in a JSON file
 * 5. Stores all data in a SQLite database
 * 6. Provides web routes for browsing the database
 */
export default class FishyAgent extends BaseAgent {
  // Schedule: Run every hour
  static schedule = "0 * * * *";

  private readonly TRACKING_FILE = "./fishing-db-tracking.json";
  private readonly SQL_SCHEMA_FILE = "./fishing-database-schema.sql";
  private readonly DB_NAME = "fishing.db";
  private fishingDb: DatabaseAPI;

  constructor(api: AgentAPI) {
    super(api);
    // Create separate database for fishing data
    this.fishingDb = new DatabaseAPI(this.DB_NAME);
    
    // Register web routes
    this.registerRoutes();
  }

  /**
   * Register web routes for the fishy interface
   */
  private registerRoutes(): void {
    // Register HTML page route
    this.api.http.registerRoute("/fishy", (req: Request) => {
      return this.handleGetHTML(req);
    });

    // Register HTML page route with trailing slash
    this.api.http.registerRoute("/fishy/", (req: Request) => {
      return this.handleGetHTML(req);
    });

    // Register API route for all fish
    this.api.http.registerRoute("/fishy/api/fish", async (req: Request) => {
      return await this.handleGetAllFish(req);
    });

    // Register API route for single fish (handled via prefix matching)
    // The AgentRegistry will match /fishy/api/fish/:id via prefix matching
    this.api.http.registerRoute("/fishy/api/fish/", async (req: Request) => {
      return await this.handleGetFishById(req);
    });
  }

  /**
   * Get CORS headers
   */
  private getCorsHeaders(): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }

  /**
   * Handle GET request for HTML page
   */
  private handleGetHTML(req: Request): Response {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: this.getCorsHeaders() });
    }

    return new Response(this.getHTML(), {
      headers: {
        "Content-Type": "text/html",
        ...this.getCorsHeaders(),
      },
    });
  }

  /**
   * Handle GET request for all fish
   */
  private async handleGetAllFish(req: Request): Promise<Response> {
    const corsHeaders = this.getCorsHeaders();

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const fish = await this.fishingDb.query<{
        id: number;
        name: string;
        binomial: string;
        aliases: string;
        lifecycle: string;
        habitats: string;
        habits: string;
        fishing_tips: string;
      }>("SELECT * FROM fish ORDER BY name");

      // Parse JSON fields
      const fishWithParsed = fish.map((f) => ({
        ...f,
        aliases: f.aliases ? JSON.parse(f.aliases) : [],
        habitats: f.habitats ? JSON.parse(f.habitats) : [],
      }));

      return Response.json(fishWithParsed, { headers: corsHeaders });
    } catch (error) {
      return Response.json(
        { error: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  /**
   * Handle GET request for single fish by ID
   */
  private async handleGetFishById(req: Request): Promise<Response> {
    const corsHeaders = this.getCorsHeaders();

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const path = url.pathname;
      
      // Extract fish ID from path (e.g., /fishy/api/fish/123)
      const fishId = path.replace("/fishy/api/fish/", "");
      
      if (!fishId || isNaN(parseInt(fishId))) {
        return Response.json(
          { error: "Invalid fish ID" },
          { status: 400, headers: corsHeaders }
        );
      }

      const fish = await this.fishingDb.query<{
        id: number;
        name: string;
        binomial: string;
        aliases: string;
        lifecycle: string;
        habitats: string;
        habits: string;
        fishing_tips: string;
      }>("SELECT * FROM fish WHERE id = ?", [parseInt(fishId)]);

      if (fish.length === 0) {
        return Response.json(
          { error: "Fish not found" },
          { status: 404, headers: corsHeaders }
        );
      }

      const f = fish[0];
      const fishData = {
        ...f,
        aliases: f.aliases ? JSON.parse(f.aliases) : [],
        habitats: f.habitats ? JSON.parse(f.habitats) : [],
      };

      return Response.json(fishData, { headers: corsHeaders });
    } catch (error) {
      return Response.json(
        { error: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  /**
   * Get the HTML page with React components
   */
  private getHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fishy Database - North American Fish</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 0;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }
    
    .header {
      margin-bottom: 4rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 3rem;
      text-align: center;
    }
    
    .header h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 300;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      color: #ffffff;
    }
    
    .header p {
      font-size: 1.1rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 300;
    }
    
    .content {
      padding: 0;
    }
    
    .fish-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .fish-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    
    .fish-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .fish-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
    }
    
    .fish-card:hover::before {
      opacity: 1;
    }
    
    .fish-card h3 {
      color: #ffffff;
      margin-bottom: 0.5rem;
      font-size: 1.2rem;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    
    .fish-card .binomial {
      color: rgba(255, 255, 255, 0.5);
      font-style: italic;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .fish-card .aliases {
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.8rem;
    }
    
    .fish-detail {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2rem;
      margin-top: 2rem;
    }
    
    .fish-detail h2 {
      color: #ffffff;
      margin-bottom: 1.5rem;
      font-size: 2rem;
      font-weight: 300;
      letter-spacing: -0.02em;
    }
    
    .fish-detail-section {
      margin-bottom: 2rem;
    }
    
    .fish-detail-section h3 {
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 1rem;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 500;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .fish-detail-section p {
      color: rgba(255, 255, 255, 0.7);
      line-height: 1.8;
      margin-bottom: 0.5rem;
      font-weight: 300;
    }
    
    .fish-detail-section ul {
      list-style: none;
      padding-left: 0;
    }
    
    .fish-detail-section li {
      color: rgba(255, 255, 255, 0.7);
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.02);
      margin-bottom: 0.5rem;
      border-radius: 2px;
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      font-weight: 300;
    }
    
    .loading {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.4);
      font-weight: 300;
    }
    
    .error {
      background: rgba(220, 53, 69, 0.1);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
    }
    
    .search-box {
      margin-bottom: 2rem;
    }
    
    .search-box input {
      width: 100%;
      padding: 1rem;
      font-size: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      color: #ffffff;
      font-family: 'Inter', sans-serif;
      transition: all 0.3s;
    }
    
    .search-box input::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }
    
    .search-box input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
    }
    
    .stats {
      display: flex;
      gap: 3rem;
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
    }
    
    .stat {
      text-align: center;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: 300;
      color: #ffffff;
      font-family: 'JetBrains Mono', monospace;
      margin-bottom: 0.25rem;
    }
    
    .stat-label {
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
    }
    
    button {
      marginTop: '1rem';
      padding: '0.75rem 1.5rem';
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      font-family: 'Inter', sans-serif;
      font-weight: 500;
      transition: all 0.3s;
    }
    
    button:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
      }
      
      .fish-list {
        grid-template-columns: 1fr;
      }
      
      .stats {
        flex-direction: column;
        gap: 1.5rem;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script>
    const { useState, useEffect } = React;
    
    function App() {
      const [fish, setFish] = useState([]);
      const [selectedFish, setSelectedFish] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      
      useEffect(() => {
        fetch('/fishy/api/fish')
          .then(res => res.json())
          .then(data => {
            setFish(data);
            setLoading(false);
          })
          .catch(err => {
            setError(err.message);
            setLoading(false);
          });
      }, []);
      
      const filteredFish = fish.filter(f => 
        f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.binomial.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (f.aliases && f.aliases.some(a => a.toLowerCase().includes(searchTerm.toLowerCase())))
      );
      
      if (loading) {
        return React.createElement('div', { className: 'container' },
          React.createElement('div', { className: 'loading' }, 'Loading fish database...')
        );
      }
      
      if (error) {
        return React.createElement('div', { className: 'container' },
          React.createElement('div', { className: 'error' }, 'Error: ' + error)
        );
      }
      
      return React.createElement('div', { className: 'container' },
        React.createElement('div', { className: 'header' },
          React.createElement('h1', null, '🐟 Fishy Database'),
          React.createElement('p', null, 'North American Fish Species')
        ),
        React.createElement('div', { className: 'content' },
          React.createElement('div', { className: 'stats' },
            React.createElement('div', { className: 'stat' },
              React.createElement('div', { className: 'stat-value' }, fish.length),
              React.createElement('div', { className: 'stat-label' }, 'Total Species')
            ),
            React.createElement('div', { className: 'stat' },
              React.createElement('div', { className: 'stat-value' }, filteredFish.length),
              React.createElement('div', { className: 'stat-label' }, 'Filtered Results')
            )
          ),
          React.createElement('div', { className: 'search-box' },
            React.createElement('input', {
              type: 'text',
              placeholder: 'Search by name, scientific name, or alias...',
              value: searchTerm,
              onChange: (e) => setSearchTerm(e.target.value)
            })
          ),
          selectedFish && React.createElement('div', { className: 'fish-detail' },
            React.createElement('h2', null, selectedFish.name),
            React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Scientific Name'),
              React.createElement('p', { style: { fontStyle: 'italic', fontSize: '1.1rem' } }, selectedFish.binomial)
            ),
            selectedFish.aliases && selectedFish.aliases.length > 0 && React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Aliases'),
              React.createElement('ul', null,
                selectedFish.aliases.map((alias, i) => 
                  React.createElement('li', { key: i }, alias)
                )
              )
            ),
            selectedFish.lifecycle && React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Lifecycle'),
              React.createElement('p', null, selectedFish.lifecycle)
            ),
            selectedFish.habitats && selectedFish.habitats.length > 0 && React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Habitats'),
              React.createElement('ul', null,
                selectedFish.habitats.map((habitat, i) => 
                  React.createElement('li', { key: i }, habitat)
                )
              )
            ),
            selectedFish.habits && React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Habits'),
              React.createElement('p', null, selectedFish.habits)
            ),
            selectedFish.fishing_tips && React.createElement('div', { className: 'fish-detail-section' },
              React.createElement('h3', null, 'Fishing Tips'),
              React.createElement('p', null, selectedFish.fishing_tips)
            ),
            React.createElement('button', {
              onClick: () => setSelectedFish(null),
              style: {
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.7)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontFamily: "'Inter', sans-serif",
                fontWeight: '500',
                transition: 'all 0.3s'
              }
            }, '← Back to List')
          ),
          !selectedFish && React.createElement('div', { className: 'fish-list' },
            filteredFish.map(f => 
              React.createElement('div', {
                key: f.id,
                className: 'fish-card',
                onClick: () => setSelectedFish(f)
              },
                React.createElement('h3', null, f.name),
                React.createElement('div', { className: 'binomial' }, f.binomial),
                f.aliases && f.aliases.length > 0 && React.createElement('div', { className: 'aliases' },
                  'Also known as: ' + f.aliases.slice(0, 2).join(', ') + (f.aliases.length > 2 ? '...' : '')
                )
              )
            )
          )
        )
      );
    }
    
    ReactDOM.render(React.createElement(App), document.getElementById('root'));
  </script>
</body>
</html>`;
  }

  async execute(): Promise<void> {
    console.log("🐟 Fishy Agent executing...\n");

    try {
      // Step 1: Initialize database schema
      await this.initializeDatabase();

      // Step 2: Load or create tracking file
      const tracking = await this.loadTracking();

      // Step 3: Get list of North American fish
      const fishList = await this.getFishList();

      // Step 4: Process ONE fish that hasn't been processed yet
      let processedCount = 0;
      for (const fishName of fishList) {
        if (!tracking[fishName] || !tracking[fishName].processed) {
          console.log(`\n📝 Processing: ${fishName}`);
          try {
            await this.processFish(fishName);
            tracking[fishName] = {
              processed: true,
              processedAt: new Date().toISOString(),
            };
            processedCount++;
            // Only process one fish per run
            break;
          } catch (error) {
            console.error(`❌ Error processing ${fishName}:`, error);
            tracking[fishName] = {
              processed: false,
              error: (error as Error).message,
              lastAttempt: new Date().toISOString(),
            };
            // Continue to next fish if this one failed
            continue;
          }
        } else {
          console.log(`⏭️  Skipping ${fishName} (already processed)`);
        }
      }

      // Step 5: Save tracking file
      await this.saveTracking(tracking);

      console.log(`\n✅ Fishy Agent completed!`);
      if (processedCount > 0) {
        console.log(`   Processed 1 new fish species`);
      } else {
        console.log(`   No new fish to process`);
      }
      
      // Count how many are processed vs total
      const processedTotal = Object.values(tracking).filter(t => t.processed).length;
      const remaining = fishList.length - processedTotal;
      console.log(`   Progress: ${processedTotal}/${fishList.length} fish processed (${remaining} remaining)`);
    } catch (error) {
      console.error("❌ Error in Fishy Agent:", error);
      throw error;
    }
  }

  /**
   * Initialize the database schema
   */
  private async initializeDatabase(): Promise<void> {
    console.log("📊 Initializing database schema...");

    const schema = `
-- Fishing Database Schema
-- Stores comprehensive information about North American fish species

CREATE TABLE IF NOT EXISTS fish (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  binomial TEXT NOT NULL,
  aliases TEXT, -- JSON array of alternative names
  lifecycle TEXT, -- Lifecycle information
  habitats TEXT, -- JSON array of habitats
  habits TEXT, -- Behavioral habits
  fishing_tips TEXT, -- Fishing tips and techniques
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_fish_name ON fish(name);
CREATE INDEX IF NOT EXISTS idx_fish_binomial ON fish(binomial);

-- Create SQL schema file for reference
`;

    // Create the database and schema in the fishing database
    await this.fishingDb.execute(`
      CREATE TABLE IF NOT EXISTS fish (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        binomial TEXT NOT NULL,
        aliases TEXT,
        lifecycle TEXT,
        habitats TEXT,
        habits TEXT,
        fishing_tips TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);

    await this.fishingDb.execute(`
      CREATE INDEX IF NOT EXISTS idx_fish_name ON fish(name)
    `);

    await this.fishingDb.execute(`
      CREATE INDEX IF NOT EXISTS idx_fish_binomial ON fish(binomial)
    `);

    // Save schema to file
    try {
      await this.api.files.write(this.SQL_SCHEMA_FILE, schema);
      console.log(`   ✅ Schema file created: ${this.SQL_SCHEMA_FILE}`);
    } catch (error) {
      console.log(`   ⚠️  Could not write schema file: ${error}`);
    }

    console.log("   ✅ Database schema initialized");
  }

  /**
   * Load tracking file or create new one
   */
  private async loadTracking(): Promise<Record<string, { processed: boolean; processedAt?: string; error?: string; lastAttempt?: string }>> {
    try {
      const content = await this.api.files.read(this.TRACKING_FILE);
      return JSON.parse(content);
    } catch {
      // File doesn't exist, return empty tracking
      return {};
    }
  }

  /**
   * Save tracking file
   */
  private async saveTracking(tracking: Record<string, { processed: boolean; processedAt?: string; error?: string; lastAttempt?: string }>): Promise<void> {
    const content = JSON.stringify(tracking, null, 2);
    await this.api.files.write(this.TRACKING_FILE, content);
    console.log(`\n💾 Tracking file saved: ${this.TRACKING_FILE}`);
  }

  /**
   * Get list of North American fish species using AI
   */
  private async getFishList(): Promise<string[]> {
    console.log("🐟 Getting list of North American fish species...");

    // Check if we have a cached list in memory
    const cached = await this.api.memory.retrieve("north_american_fish_list");
    if (cached && Array.isArray(cached)) {
      console.log(`   ✅ Using cached list (${cached.length} species)`);
      return cached as string[];
    }

    // Use AI to generate comprehensive list
    const prompt = `Create a comprehensive list of North American freshwater and saltwater fish species. 
Return ONLY a JSON array of fish common names, one per line, like this:
["Largemouth Bass", "Smallmouth Bass", "Rainbow Trout", ...]

Include:
- Freshwater fish (bass, trout, salmon, pike, walleye, catfish, etc.)
- Saltwater fish (tuna, cod, halibut, snapper, grouper, etc.)
- Both common and game fish
- At least 100 different species

Return ONLY the JSON array, no other text.`;

    try {
      const response = await this.api.ai.complete(prompt, {
        temperature: 0.3, // Lower temperature for more consistent results
        maxTokens: 4000,
      });

      // Try to extract JSON array from response
      let fishList: string[] = [];
      try {
        // Look for JSON array in the response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          fishList = JSON.parse(jsonMatch[0]);
        } else {
          // Try parsing the whole response
          fishList = JSON.parse(response.trim());
        }
      } catch {
        // If JSON parsing fails, try to extract fish names from text
        const lines = response.split("\n").filter(line => line.trim());
        fishList = lines
          .map(line => {
            // Remove quotes, brackets, commas
            return line.replace(/^[\s"\[\],-]+|[\s"\[\],-]+$/g, "").trim();
          })
          .filter(name => name.length > 0 && name.length < 100);
      }

      if (fishList.length === 0) {
        // Fallback: Use a curated list if AI fails
        fishList = this.getFallbackFishList();
      }

      // Cache the list
      await this.api.memory.store("north_american_fish_list", fishList);
      console.log(`   ✅ Generated list with ${fishList.length} species`);
      return fishList;
    } catch (error) {
      console.error("   ⚠️  Error generating fish list, using fallback:", error);
      return this.getFallbackFishList();
    }
  }

  /**
   * Fallback list of common North American fish
   */
  private getFallbackFishList(): string[] {
    return [
      "Largemouth Bass", "Smallmouth Bass", "Spotted Bass", "Striped Bass",
      "Rainbow Trout", "Brown Trout", "Brook Trout", "Lake Trout", "Cutthroat Trout",
      "Chinook Salmon", "Coho Salmon", "Sockeye Salmon", "Pink Salmon", "Atlantic Salmon",
      "Northern Pike", "Muskellunge", "Chain Pickerel",
      "Walleye", "Yellow Perch", "White Perch",
      "Bluegill", "Redear Sunfish", "Pumpkinseed", "Crappie", "Rock Bass",
      "Channel Catfish", "Blue Catfish", "Flathead Catfish", "Bullhead",
      "Carp", "Common Carp", "Grass Carp",
      "Sturgeon", "Paddlefish",
      "Bluefish", "Striped Bass", "Weakfish", "Redfish", "Black Drum",
      "Flounder", "Summer Flounder", "Winter Flounder", "Halibut",
      "Cod", "Haddock", "Pollock",
      "Tuna", "Bluefin Tuna", "Yellowfin Tuna", "Albacore",
      "Snapper", "Red Snapper", "Yellowtail Snapper",
      "Grouper", "Black Grouper", "Red Grouper",
      "Mackerel", "Spanish Mackerel", "King Mackerel",
      "Mahi Mahi", "Wahoo", "Amberjack",
      "Sheepshead", "Porgy", "Scup",
      "Triggerfish", "Filefish",
      "Tarpon", "Bonefish", "Permit",
      "Snook", "Redfish", "Speckled Trout",
      "Cobia", "Lingcod", "Rockfish",
    ];
  }

  /**
   * Process a single fish species - get detailed information and store in database
   */
  private async processFish(fishName: string): Promise<void> {
    // Check if fish already exists in database
    const existing = await this.fishingDb.query<{ id: number }>(
      "SELECT id FROM fish WHERE name = ?",
      [fishName]
    );

    if (existing.length > 0) {
      console.log(`   ⏭️  ${fishName} already in database`);
      return;
    }

    // Use AI to get detailed fish information
    const prompt = `Provide detailed information about the fish species: ${fishName}

Return a JSON object with the following structure:
{
  "name": "${fishName}",
  "binomial": "Scientific name (Genus species)",
  "aliases": ["alternative name 1", "alternative name 2"],
  "lifecycle": "Detailed lifecycle information including spawning, growth, lifespan",
  "habitats": ["habitat 1", "habitat 2", "habitat 3"],
  "habits": "Behavioral habits, feeding patterns, activity times",
  "fishing_tips": "Specific fishing tips, best techniques, bait/lure recommendations, best times to fish"
}

Be comprehensive and accurate. Return ONLY the JSON object, no other text.`;

    try {
      const response = await this.api.ai.complete(prompt, {
        temperature: 0.4,
        maxTokens: 2000,
      });

      // Parse the JSON response with better error handling
      let fishData: {
        name: string;
        binomial: string;
        aliases: string[];
        lifecycle: string;
        habitats: string[];
        habits: string;
        fishing_tips: string;
      };

      try {
        // Try multiple strategies to extract JSON
        let jsonText = response.trim();
        
        // Remove markdown code blocks if present
        if (jsonText.includes("```json")) {
          jsonText = jsonText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
        } else if (jsonText.includes("```")) {
          jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }
        
        // Try to find JSON object boundaries
        const jsonStart = jsonText.indexOf("{");
        const jsonEnd = jsonText.lastIndexOf("}");
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        // Try to fix incomplete JSON (common issues)
        // If JSON ends abruptly, try to close it
        if (!jsonText.trim().endsWith("}")) {
          // Count open braces
          const openBraces = (jsonText.match(/\{/g) || []).length;
          const closeBraces = (jsonText.match(/\}/g) || []).length;
          const missing = openBraces - closeBraces;
          
          // Try to close incomplete strings and objects
          if (missing > 0) {
            // Check if we're in the middle of a string
            const lastQuote = jsonText.lastIndexOf('"');
            const lastOpenBrace = jsonText.lastIndexOf('{');
            if (lastQuote > lastOpenBrace) {
              // We're in a string, close it
              jsonText = jsonText.trim() + '"';
            }
            // Close objects
            for (let i = 0; i < missing; i++) {
              jsonText += "}";
            }
          }
        }
        
        fishData = JSON.parse(jsonText);
      } catch (parseError) {
        // If parsing still fails, log the response for debugging and use fallback
        console.error(`   ⚠️  JSON parsing failed. Response preview: ${response.substring(0, 200)}...`);
        console.error(`   ⚠️  Parse error: ${parseError}`);
        
        // Try to extract basic information from the response text as fallback
        const nameMatch = response.match(/"name"\s*:\s*"([^"]+)"/i) || 
                         response.match(/name[:\s]+([A-Za-z\s]+)/i);
        const binomialMatch = response.match(/"binomial"\s*:\s*"([^"]+)"/i) ||
                             response.match(/binomial[:\s]+([A-Za-z\s]+)/i) ||
                             response.match(/([A-Z][a-z]+\s+[a-z]+)/); // Scientific name pattern
        
        if (nameMatch && nameMatch[1] && binomialMatch && binomialMatch[1]) {
          // Create minimal fish data from extracted info
          fishData = {
            name: nameMatch[1].trim(),
            binomial: binomialMatch[1].trim(),
            aliases: [],
            lifecycle: response.includes("lifecycle") ? "See full response for details" : "",
            habitats: [],
            habits: response.includes("habits") ? "See full response for details" : "",
            fishing_tips: response.includes("fishing") ? "See full response for details" : "",
          };
          console.log(`   ⚠️  Using fallback data extraction for ${fishData.name}`);
        } else {
          throw new Error(`Failed to parse AI response and could not extract basic info: ${parseError}`);
        }
      }

      // Validate required fields
      if (!fishData.name || !fishData.binomial) {
        throw new Error("Missing required fields: name or binomial");
      }

      // Insert into database
      await this.fishingDb.execute(
        `INSERT INTO fish (name, binomial, aliases, lifecycle, habitats, habits, fishing_tips)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          fishData.name,
          fishData.binomial,
          JSON.stringify(fishData.aliases || []),
          fishData.lifecycle || "",
          JSON.stringify(fishData.habitats || []),
          fishData.habits || "",
          fishData.fishing_tips || "",
        ]
      );

      console.log(`   ✅ Stored ${fishName} in database`);
    } catch (error) {
      console.error(`   ❌ Error processing ${fishName}:`, error);
      throw error;
    }
  }
}

