/**
 * ClawGuard v0.3.0 - Activity Monitor Frontend
 * Features: Activity feed, Analytics, Files tracker, Bookmarks, Dependency graph
 */

// State
let currentActivity = [];
let currentOffset = 0;
let currentLimit = 50;
let currentFilters = {
  category: 'all',
  risk: 'all',
  tool: 'all',
  search: '',
  session: 'all',
  dateFrom: null,
  dateTo: null,
};
let meta = {};
let stats = {};
let ws = null;
let timelineChart = null;
let toolUsageChart = null;
let categoryChart = null;
let dependencyNetwork = null;
let bookmarks = [];
let allTools = [];

// DOM Elements
const elements = {
  activityFeed: document.getElementById('activity-feed'),
  activityCount: document.getElementById('activity-count'),
  searchInput: document.getElementById('search-input'),
  categoryFilter: document.getElementById('category-filter'),
  riskFilter: document.getElementById('risk-filter'),
  toolFilter: document.getElementById('tool-filter'),
  dateFrom: document.getElementById('date-from'),
  dateTo: document.getElementById('date-to'),
  sessionSelect: document.getElementById('session-select'),
  refreshBtn: document.getElementById('refresh-btn'),
  loadMoreBtn: document.getElementById('load-more-btn'),
  loadMoreContainer: document.getElementById('load-more-container'),
  detailModal: document.getElementById('detail-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalContent: document.getElementById('modal-content'),
  modalClose: document.getElementById('modal-close'),
  statTotal: document.getElementById('stat-total'),
  statShell: document.getElementById('stat-shell'),
  statFile: document.getElementById('stat-file'),
  statNetwork: document.getElementById('stat-network'),
  statHigh: document.getElementById('stat-high'),
  statCritical: document.getElementById('stat-critical'),
  liveIndicator: document.getElementById('live-indicator'),
  timelineChart: document.getElementById('timeline-chart'),
  timelineRange: document.getElementById('timeline-range'),
  suspiciousSequences: document.getElementById('suspicious-sequences'),
  sequencesCount: document.getElementById('sequences-count'),
  bookmarkCount: document.getElementById('bookmark-count'),
  bookmarksList: document.getElementById('bookmarks-list'),
  fileList: document.getElementById('file-list'),
  topFiles: document.getElementById('top-files'),
  activityHeatmap: document.getElementById('activity-heatmap'),
};

// Initialize
async function init() {
  loadLocalSettings();
  loadBookmarks();
  await loadMeta();
  await loadSessions();
  initCharts();
  await loadActivity();
  await loadStats();
  await loadSuspiciousSequences();
  setupEventListeners();
  setupWebSocket();
  checkGatewayStatus();
  checkForUpdate();
  
  setInterval(checkGatewayStatus, 30000);
}

// ============================================
// TAB MANAGEMENT
// ============================================

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    }
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
  
  // Load tab-specific data
  if (tabName === 'analytics') {
    loadAnalytics();
  } else if (tabName === 'files') {
    loadFileOperations();
  } else if (tabName === 'bookmarks') {
    renderBookmarks();
  }
}

// ============================================
// BOOKMARKS
// ============================================

function loadBookmarks() {
  try {
    const saved = localStorage.getItem('clawguard-bookmarks');
    bookmarks = saved ? JSON.parse(saved) : [];
    updateBookmarkCount();
  } catch (e) {
    bookmarks = [];
  }
}

function saveBookmarks() {
  localStorage.setItem('clawguard-bookmarks', JSON.stringify(bookmarks));
  updateBookmarkCount();
}

function updateBookmarkCount() {
  const countEl = elements.bookmarkCount;
  if (bookmarks.length > 0) {
    countEl.textContent = bookmarks.length;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
}

function toggleBookmark(item) {
  const index = bookmarks.findIndex(b => b.id === item.id);
  if (index >= 0) {
    bookmarks.splice(index, 1);
  } else {
    bookmarks.unshift({
      ...item,
      bookmarkedAt: new Date().toISOString(),
    });
  }
  saveBookmarks();
  // Re-render current activity to update star states
  loadActivity();
}

function isBookmarked(itemId) {
  return bookmarks.some(b => b.id === itemId);
}

function renderBookmarks() {
  if (bookmarks.length === 0) {
    elements.bookmarksList.innerHTML = `
      <div class="text-slate-500 text-center py-8">No bookmarks yet. Click the star on any activity to bookmark it.</div>
    `;
    return;
  }
  
  elements.bookmarksList.innerHTML = bookmarks.map(item => `
    <div class="activity-item bg-slate-800/50 rounded-lg p-3 hover:bg-slate-800 cursor-pointer transition-colors" onclick="showDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="font-medium text-white">${item.tool}</span>
            <span class="text-xs px-2 py-0.5 rounded-full border ${getRiskClasses(item.risk?.level)}">
              ${item.risk?.level || 'unknown'}
            </span>
          </div>
          <div class="text-sm text-slate-400 truncate code-block">${escapeHtml(getActivitySummary(item))}</div>
          <div class="text-xs text-slate-500 mt-1">Bookmarked ${getTimeAgo(item.bookmarkedAt)}</div>
        </div>
        <button class="bookmark-btn bookmarked text-yellow-400" onclick="event.stopPropagation(); toggleBookmark(${JSON.stringify(item).replace(/"/g, '&quot;')})">
          ★
        </button>
      </div>
    </div>
  `).join('');
}

function clearAllBookmarks() {
  if (confirm('Clear all bookmarks?')) {
    bookmarks = [];
    saveBookmarks();
    renderBookmarks();
    loadActivity(); // Re-render to update star states
  }
}

// ============================================
// ANALYTICS
// ============================================

async function loadAnalytics() {
  await loadStats();
  renderToolUsageChart();
  renderCategoryChart();
  renderActivityHeatmap();
  await loadDependencyGraph();
}

function renderToolUsageChart() {
  if (!stats.byTool) return;
  
  const ctx = document.getElementById('tool-usage-chart')?.getContext('2d');
  if (!ctx) return;
  
  // Sort tools by usage and take top 10
  const sorted = Object.entries(stats.byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  const labels = sorted.map(([tool]) => tool);
  const data = sorted.map(([, count]) => count);
  
  const colors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
  ];
  
  if (toolUsageChart) {
    toolUsageChart.data.labels = labels;
    toolUsageChart.data.datasets[0].data = data;
    toolUsageChart.update();
  } else {
    toolUsageChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Usage',
          data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 4,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            grid: { color: '#1e293b' },
            ticks: { color: '#64748b' }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });
  }
}

function renderCategoryChart() {
  if (!stats.byCategory) return;
  
  const ctx = document.getElementById('category-chart')?.getContext('2d');
  if (!ctx) return;
  
  const labels = Object.keys(stats.byCategory);
  const data = Object.values(stats.byCategory);
  
  const colorMap = {
    shell: '#eab308',
    file: '#3b82f6',
    network: '#8b5cf6',
    browser: '#06b6d4',
    message: '#22c55e',
    system: '#f97316',
    memory: '#ec4899',
  };
  
  const colors = labels.map(l => colorMap[l] || '#64748b');
  
  if (categoryChart) {
    categoryChart.data.labels = labels;
    categoryChart.data.datasets[0].data = data;
    categoryChart.data.datasets[0].backgroundColor = colors;
    categoryChart.update();
  } else {
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8' }
          },
        },
      }
    });
  }
}

function renderActivityHeatmap() {
  // Aggregate byHour into byDay for the yearly view (recalculate each time)
  stats.byDay = {};
  if (stats.byHour) {
    Object.entries(stats.byHour).forEach(([key, val]) => {
      const day = key.substring(0, 10); // YYYY-MM-DD (already in local time from server)
      stats.byDay[day] = (stats.byDay[day] || 0) + val;
    });
  }
  
  const container = elements.activityHeatmap;
  
  // GitHub-style: 52 weeks x 7 days, most recent on the right
  const now = new Date();
  const weeks = 52;
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // Find the start date (52 weeks ago, aligned to Sunday)
  const startDate = new Date(now.getTime()); // Clone to avoid mutation
  startDate.setDate(startDate.getDate() - (weeks * 7) - now.getDay());
  
  // Build array of all days
  const allDays = [];
  const current = new Date(startDate);
  while (current <= now) {
    allDays.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  // Find max value for scaling
  let maxVal = 1;
  allDays.forEach(day => {
    const year = day.getFullYear();
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const dayNum = String(day.getDate()).padStart(2, '0');
    const key = `${year}-${month}-${dayNum}`;
    const val = stats.byDay[key] || 0;
    if (val > maxVal) maxVal = val;
  });
  
  // Group days into weeks
  const weekGroups = [];
  let currentWeek = [];
  allDays.forEach(day => {
    if (day.getDay() === 0 && currentWeek.length > 0) {
      weekGroups.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) weekGroups.push(currentWeek);
  
  // Generate HTML - GitHub style grid, stretch to fill width
  let html = '<div class="w-full pb-2">';
  html += '<div class="flex gap-[2px]">';
  
  // Day labels column - show all 7 days
  html += '<div class="flex flex-col gap-[2px] pr-2 flex-shrink-0">';
  daysOfWeek.forEach((day) => {
    html += `<div class="h-[14px] text-[10px] text-slate-500 flex items-center leading-none">${day.substring(0, 3)}</div>`;
  });
  html += '</div>';
  
  // Week columns - explicitly position each day in the correct row (0-6)
  let lastMonth = -1;
  weekGroups.forEach((week, weekIdx) => {
    lastMonth = week[week.length - 1].getMonth();
    
    // Build an array of 7 slots for Sun-Sat
    const slots = new Array(7).fill(null);
    week.forEach(day => {
      slots[day.getDay()] = day;
    });
    
    html += '<div class="flex flex-col gap-[2px] flex-1">';
    
    // Render all 7 rows
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const day = slots[dayOfWeek];
      
      if (!day) {
        // Empty slot
        html += '<div class="w-full h-[14px] rounded-sm"></div>';
      } else {
        const year = day.getFullYear();
        const month = String(day.getMonth() + 1).padStart(2, '0');
        const dayNum = String(day.getDate()).padStart(2, '0');
        const key = `${year}-${month}-${dayNum}`;
        const val = stats.byDay[key] || 0;
        
        // Use log scale for better visibility of lower values
        const logIntensity = val > 0 ? Math.log10(val + 1) / Math.log10(maxVal + 1) : 0;
        
        let bgColor;
        if (val === 0) bgColor = 'bg-slate-800/60';
        else if (logIntensity < 0.4) bgColor = 'bg-green-800';
        else if (logIntensity < 0.6) bgColor = 'bg-green-600';
        else if (logIntensity < 0.8) bgColor = 'bg-green-500';
        else bgColor = 'bg-green-400';
        
        const dateStr = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        html += `<div class="heatmap-cell w-full h-[14px] rounded-sm ${bgColor} cursor-pointer hover:ring-1 hover:ring-white/50" title="${dateStr}: ${val} actions"></div>`;
      }
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  
  // Month labels - positioned using flex
  html += '<div class="flex gap-[2px] mt-2 ml-8 text-[10px] text-slate-500">';
  let monthPositions = [];
  lastMonth = -1;
  weekGroups.forEach((week, weekIdx) => {
    const firstDay = week[0];
    if (firstDay.getMonth() !== lastMonth) {
      monthPositions.push({ month: firstDay.toLocaleDateString('en-US', { month: 'short' }), pos: weekIdx, weeksInMonth: 1 });
      lastMonth = firstDay.getMonth();
    } else if (monthPositions.length > 0) {
      monthPositions[monthPositions.length - 1].weeksInMonth++;
    }
  });
  // Calculate weeks for last month
  if (monthPositions.length > 0) {
    monthPositions[monthPositions.length - 1].weeksInMonth = weekGroups.length - monthPositions[monthPositions.length - 1].pos;
  }
  monthPositions.forEach((m, i) => {
    const nextPos = monthPositions[i + 1]?.pos || weekGroups.length;
    const weeksSpan = nextPos - m.pos;
    html += `<div class="flex-1" style="flex: ${weeksSpan};">${m.month}</div>`;
  });
  html += '</div>';
  
  // Legend
  html += '<div class="flex items-center justify-end gap-2 mt-3 text-[10px] text-slate-500">';
  html += '<span>Less</span>';
  html += '<div class="flex gap-[2px]">';
  html += '<div class="w-3 h-3 rounded-sm bg-slate-800/60"></div>';
  html += '<div class="w-3 h-3 rounded-sm bg-green-900"></div>';
  html += '<div class="w-3 h-3 rounded-sm bg-green-700"></div>';
  html += '<div class="w-3 h-3 rounded-sm bg-green-500"></div>';
  html += '<div class="w-3 h-3 rounded-sm bg-green-400"></div>';
  html += '</div>';
  html += '<span>More</span>';
  html += '</div>';
  
  html += '</div>';
  container.innerHTML = html;
}

// ============================================
// DEPENDENCY GRAPH
// ============================================

async function loadDependencyGraph() {
  try {
    const res = await fetch('/api/activity?limit=500');
    const data = await res.json();
    
    const activity = data.activity || [];
    buildDependencyGraph(activity);
  } catch (error) {
    console.error('Failed to load dependency graph:', error);
  }
}

function buildDependencyGraph(activity) {
  const container = document.getElementById('dependency-graph');
  if (!container) return;
  
  // Build nodes and edges based on tool relationships
  const toolCounts = {};
  const edges = {};
  
  // Track file paths to detect dependencies
  const fileReads = new Map(); // path -> tool that read it
  const fileWrites = new Map(); // path -> tool that wrote it
  
  // Sort by time
  const sorted = [...activity].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  sorted.forEach((item, index) => {
    const tool = item.tool;
    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    
    const path = item.arguments?.path || item.arguments?.file_path;
    
    // Track reads and writes
    if (tool === 'read' || tool === 'Read') {
      if (path && fileWrites.has(path)) {
        // This tool read a file that was written by another
        const writerTool = fileWrites.get(path);
        const edgeKey = `${writerTool}->${tool}`;
        edges[edgeKey] = (edges[edgeKey] || 0) + 1;
      }
      if (path) fileReads.set(path, tool);
    }
    
    if (tool === 'write' || tool === 'Write' || tool === 'edit' || tool === 'Edit') {
      if (path) fileWrites.set(path, tool);
    }
    
    // Track exec -> web_fetch patterns
    if (tool === 'exec' && index > 0) {
      const prev = sorted[index - 1];
      const timeDiff = new Date(item.timestamp) - new Date(prev.timestamp);
      if (timeDiff < 60000 && prev.tool !== tool) {
        const edgeKey = `${prev.tool}->${tool}`;
        edges[edgeKey] = (edges[edgeKey] || 0) + 1;
      }
    }
    
    // Track sequential tool usage (within 30 seconds)
    if (index > 0) {
      const prev = sorted[index - 1];
      const timeDiff = new Date(item.timestamp) - new Date(prev.timestamp);
      if (timeDiff < 30000 && prev.tool !== tool) {
        const edgeKey = `${prev.tool}->${tool}`;
        edges[edgeKey] = (edges[edgeKey] || 0) + 1;
      }
    }
  });
  
  // Create vis.js nodes
  const colorMap = {
    exec: '#eab308',
    read: '#3b82f6', Read: '#3b82f6',
    write: '#22c55e', Write: '#22c55e',
    edit: '#06b6d4', Edit: '#06b6d4',
    web_fetch: '#8b5cf6',
    web_search: '#a855f7',
    browser: '#06b6d4',
    message: '#ec4899',
    cron: '#f97316',
    process: '#f59e0b',
  };
  
  const nodes = Object.entries(toolCounts).map(([tool, count]) => ({
    id: tool,
    label: `${tool}\n(${count})`,
    value: count,
    color: {
      background: colorMap[tool] || '#64748b',
      border: colorMap[tool] || '#64748b',
      highlight: { background: '#fff', border: colorMap[tool] || '#64748b' }
    },
    font: { color: '#fff', size: 12 },
  }));
  
  // Create edges (only significant ones)
  const edgeList = Object.entries(edges)
    .filter(([, count]) => count >= 2) // Only show edges with 2+ occurrences
    .map(([key, count]) => {
      const [from, to] = key.split('->');
      return {
        from,
        to,
        value: count,
        title: `${count} times`,
        arrows: 'to',
        color: { color: '#475569', highlight: '#94a3b8' },
      };
    });
  
  // Initialize vis.js network
  const visData = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edgeList),
  };
  
  const options = {
    physics: {
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -50,
        springLength: 100,
      },
      stabilization: { iterations: 100 },
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
    },
    nodes: {
      shape: 'dot',
      scaling: {
        min: 10,
        max: 40,
      },
    },
    edges: {
      smooth: {
        type: 'continuous',
      },
      scaling: {
        min: 1,
        max: 5,
      },
    },
  };
  
  if (dependencyNetwork) {
    dependencyNetwork.setData(visData);
  } else {
    dependencyNetwork = new vis.Network(container, visData, options);
    
    // Add click handler for nodes
    dependencyNetwork.on('click', function(params) {
      if (params.nodes.length > 0) {
        const toolName = params.nodes[0];
        showToolDetails(toolName, activity);
      }
    });
  }
}

// Show details for a specific tool when clicked in dependency graph
async function showToolDetails(toolName, activity) {
  const toolActivity = activity.filter(a => a.tool === toolName).slice(0, 20);
  
  elements.modalTitle.textContent = `Tool: ${toolName}`;
  elements.modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-4 text-sm">
        <span class="text-slate-400">Total calls:</span>
        <span class="text-white font-bold">${activity.filter(a => a.tool === toolName).length}</span>
      </div>
      
      <div>
        <div class="text-sm text-slate-400 mb-2">Recent Activity:</div>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          ${toolActivity.map(item => `
            <div class="bg-slate-800 rounded p-3 cursor-pointer hover:bg-slate-700" onclick="showDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs px-2 py-0.5 rounded-full border ${getRiskClasses(item.risk?.level)}">${item.risk?.level || 'unknown'}</span>
                <span class="text-xs text-slate-500">${getTimeAgo(item.timestamp)}</span>
              </div>
              <div class="text-sm text-slate-300 truncate code-block">${escapeHtml(getActivitySummary(item))}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  elements.detailModal.classList.remove('hidden');
  elements.detailModal.classList.add('flex');
}

// ============================================
// FILE OPERATIONS
// ============================================

async function loadFileOperations() {
  const filter = document.getElementById('file-op-filter')?.value || 'all';
  
  try {
    const res = await fetch('/api/activity?limit=1000');
    const data = await res.json();
    
    // Filter for file operations
    let fileOps = (data.activity || []).filter(a => {
      const isFileOp = ['read', 'Read', 'write', 'Write', 'edit', 'Edit'].includes(a.tool);
      if (!isFileOp) return false;
      if (filter === 'all') return true;
      return a.tool.toLowerCase() === filter;
    });
    
    // Group by file path
    const byPath = {};
    fileOps.forEach(op => {
      const path = op.arguments?.path || op.arguments?.file_path || 'unknown';
      if (!byPath[path]) {
        byPath[path] = {
          path,
          operations: [],
          lastModified: op.timestamp,
        };
      }
      byPath[path].operations.push(op);
      if (new Date(op.timestamp) > new Date(byPath[path].lastModified)) {
        byPath[path].lastModified = op.timestamp;
      }
    });
    
    // Sort by last modified
    const sorted = Object.values(byPath).sort((a, b) => 
      new Date(b.lastModified) - new Date(a.lastModified)
    );
    
    // Render file list
    if (sorted.length === 0) {
      elements.fileList.innerHTML = '<div class="text-slate-500 text-center py-8">No file operations found</div>';
    } else {
      elements.fileList.innerHTML = sorted.slice(0, 100).map(file => {
        const writes = file.operations.filter(o => ['write', 'Write'].includes(o.tool)).length;
        const edits = file.operations.filter(o => ['edit', 'Edit'].includes(o.tool)).length;
        const reads = file.operations.filter(o => ['read', 'Read'].includes(o.tool)).length;
        
        return `
          <div class="bg-slate-800/50 rounded-lg p-3 hover:bg-slate-800 cursor-pointer transition-colors" onclick="showFileDetail('${escapeHtml(file.path)}')">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-mono text-sm text-white truncate">${escapeHtml(file.path)}</div>
                <div class="flex gap-3 mt-1 text-xs">
                  ${writes > 0 ? `<span class="text-green-400">${writes} writes</span>` : ''}
                  ${edits > 0 ? `<span class="text-cyan-400">${edits} edits</span>` : ''}
                  ${reads > 0 ? `<span class="text-blue-400">${reads} reads</span>` : ''}
                </div>
              </div>
              <span class="text-xs text-slate-500">${getTimeAgo(file.lastModified)}</span>
            </div>
          </div>
        `;
      }).join('');
    }
    
    // Render top files
    await loadTopFiles();
  } catch (error) {
    console.error('Failed to load file operations:', error);
    elements.fileList.innerHTML = '<div class="text-red-400 text-center py-8">Failed to load</div>';
  }
}

async function loadTopFiles() {
  if (stats.topPaths) {
    elements.topFiles.innerHTML = stats.topPaths.map((item, i) => `
      <div class="flex items-center justify-between bg-slate-800/50 rounded p-2 hover:bg-slate-800 cursor-pointer" onclick="showFileDetail('${escapeHtml(item.path)}')">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-slate-500 text-xs w-4">${i + 1}.</span>
          <span class="font-mono text-sm text-white truncate">${escapeHtml(item.path)}</span>
        </div>
        <span class="text-xs text-slate-400 flex-shrink-0">${item.count} ops</span>
      </div>
    `).join('');
  }
}

window.showFileDetail = async function(path) {
  const modal = document.getElementById('file-modal');
  const title = document.getElementById('file-modal-title');
  const content = document.getElementById('file-modal-content');
  
  title.textContent = path;
  content.innerHTML = '<div class="text-center py-8"><div class="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div></div>';
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  try {
    const res = await fetch(`/api/activity?limit=500&search=${encodeURIComponent(path)}`);
    const data = await res.json();
    
    const operations = (data.activity || []).filter(a => {
      const p = a.arguments?.path || a.arguments?.file_path;
      return p === path;
    });
    
    content.innerHTML = `
      <div class="space-y-4">
        <div class="text-sm text-slate-400">${operations.length} operations on this file</div>
        
        <div class="space-y-3">
          ${operations.slice(0, 50).map(op => {
            const hasDiff = op.result?.details?.diff;
            return `
              <div class="bg-slate-800 rounded-lg p-3">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-medium ${getToolColor(op.tool)}">${op.tool}</span>
                  <span class="text-xs text-slate-500">${getTimeAgo(op.timestamp)}</span>
                </div>
                ${hasDiff ? `
                  <div class="mt-2">
                    <div class="text-xs text-slate-400 mb-1">Changes:</div>
                    <pre class="code-block bg-slate-950 rounded p-2 text-xs overflow-x-auto">${formatDiff(op.result.details.diff)}</pre>
                  </div>
                ` : ''}
                ${op.arguments?.content ? `
                  <div class="mt-2">
                    <div class="text-xs text-slate-400 mb-1">Content (${formatBytes(op.arguments.content.length)}):</div>
                    <pre class="code-block bg-slate-950 rounded p-2 text-xs overflow-x-auto max-h-32">${escapeHtml(op.arguments.content.substring(0, 500))}${op.arguments.content.length > 500 ? '...' : ''}</pre>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="text-red-400">Failed to load: ${error.message}</div>`;
  }
};

function getToolColor(tool) {
  const colors = {
    read: 'text-blue-400', Read: 'text-blue-400',
    write: 'text-green-400', Write: 'text-green-400',
    edit: 'text-cyan-400', Edit: 'text-cyan-400',
    exec: 'text-yellow-400',
  };
  return colors[tool] || 'text-white';
}

// ============================================
// SETTINGS & CONFIG
// ============================================

function loadLocalSettings() {
  try {
    const saved = localStorage.getItem('clawguard-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      currentFilters = { ...currentFilters, ...settings.filters };
      
      if (settings.filters?.category) elements.categoryFilter.value = settings.filters.category;
      if (settings.filters?.risk) elements.riskFilter.value = settings.filters.risk;
      if (settings.timelineRange) elements.timelineRange.value = settings.timelineRange;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function saveLocalSettings() {
  try {
    const settings = {
      filters: {
        category: currentFilters.category,
        risk: currentFilters.risk,
      },
      timelineRange: elements.timelineRange?.value || '24',
    };
    localStorage.setItem('clawguard-settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// ============================================
// DATA LOADING
// ============================================

async function loadMeta() {
  try {
    const res = await fetch('/api/meta');
    meta = await res.json();
  } catch (error) {
    console.error('Failed to load meta:', error);
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    
    elements.sessionSelect.innerHTML = '<option value="all">All Sessions</option>';
    
    // Populate tool filter with unique tools
    const tools = new Set();
    
    for (const session of data.sessions.slice(0, 20)) {
      const date = new Date(session.modified).toLocaleDateString();
      const time = new Date(session.modified).toLocaleTimeString();
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = `${date} ${time} (${session.activityCount} actions)`;
      elements.sessionSelect.appendChild(option);
    }
    
    // Also populate graph session selector
    const graphSelect = document.getElementById('graph-session-select');
    if (graphSelect) {
      graphSelect.innerHTML = '<option value="recent">Recent Activity</option>';
      for (const session of data.sessions.slice(0, 10)) {
        const opt = document.createElement('option');
        opt.value = session.id;
        opt.textContent = new Date(session.modified).toLocaleDateString();
        graphSelect.appendChild(opt);
      }
    }
  } catch (error) {
    console.error('Failed to load sessions:', error);
  }
}

async function loadActivity(append = false) {
  try {
    if (!append) {
      elements.activityFeed.innerHTML = `
        <div class="p-8 text-center text-slate-500">
          <div class="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
          Loading activity...
        </div>
      `;
      currentOffset = 0;
    }
    
    const params = new URLSearchParams({
      limit: currentLimit,
      offset: currentOffset,
    });
    
    if (currentFilters.category !== 'all') params.set('category', currentFilters.category);
    if (currentFilters.risk !== 'all') params.set('risk', currentFilters.risk);
    if (currentFilters.search) params.set('search', currentFilters.search);
    if (currentFilters.tool !== 'all') params.set('tool', currentFilters.tool);
    if (currentFilters.dateFrom) params.set('dateFrom', currentFilters.dateFrom);
    if (currentFilters.dateTo) params.set('dateTo', currentFilters.dateTo);
    
    let url = `/api/activity?${params}`;
    if (currentFilters.session !== 'all') {
      url = `/api/sessions/${currentFilters.session}`;
    }
    
    const res = await fetch(url);
    const data = await res.json();
    
    const activity = data.activity || [];
    
    // Populate tool filter on first load
    if (!append && activity.length > 0) {
      const tools = [...new Set(activity.map(a => a.tool))].sort();
      if (allTools.length === 0) {
        allTools = tools;
        elements.toolFilter.innerHTML = '<option value="all">All Tools</option>' +
          tools.map(t => `<option value="${t}">${t}</option>`).join('');
      }
    }
    
    if (!append) {
      currentActivity = activity;
      elements.activityFeed.innerHTML = '';
    } else {
      currentActivity = [...currentActivity, ...activity];
    }
    
    for (const item of activity) {
      const el = createActivityElement(item);
      elements.activityFeed.appendChild(el);
    }
    
    if (currentActivity.length === 0) {
      elements.activityFeed.innerHTML = `
        <div class="p-8 text-center text-slate-500">
          No activity found matching your filters.
        </div>
      `;
    }
    
    const total = data.total || currentActivity.length;
    elements.activityCount.textContent = `Showing ${currentActivity.length} of ${total}`;
    
    if (data.hasMore) {
      elements.loadMoreContainer.classList.remove('hidden');
    } else {
      elements.loadMoreContainer.classList.add('hidden');
    }
    
  } catch (error) {
    console.error('Failed to load activity:', error);
    elements.activityFeed.innerHTML = `
      <div class="p-8 text-center text-red-400">
        Failed to load activity: ${error.message}
      </div>
    `;
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    stats = await res.json();
    
    elements.statTotal.textContent = stats.total.toLocaleString();
    elements.statShell.textContent = (stats.byCategory?.shell || 0).toLocaleString();
    elements.statFile.textContent = (stats.byCategory?.file || 0).toLocaleString();
    elements.statNetwork.textContent = ((stats.byCategory?.network || 0) + (stats.byCategory?.browser || 0)).toLocaleString();
    elements.statHigh.textContent = (stats.byRisk?.high || 0).toLocaleString();
    elements.statCritical.textContent = (stats.byRisk?.critical || 0).toLocaleString();
    
    if (stats.byHour && timelineChart) {
      updateTimelineChart(stats.byHour);
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

async function loadSuspiciousSequences() {
  try {
    const res = await fetch('/api/sequences');
    const data = await res.json();
    
    elements.sequencesCount.textContent = data.sequences?.length || 0;
    
    if (!data.sequences?.length) {
      elements.suspiciousSequences.innerHTML = `
        <div class="text-slate-500 text-center py-2">No suspicious patterns detected</div>
      `;
      return;
    }
    
    elements.suspiciousSequences.innerHTML = data.sequences.map(seq => `
      <div class="bg-red-500/10 border border-red-500/20 rounded p-2 cursor-pointer hover:bg-red-500/20 transition-colors" onclick="showSequenceDetail(${JSON.stringify(seq).replace(/"/g, '&quot;')})">
        <div class="font-medium text-red-400">${escapeHtml(seq.type)}</div>
        <div class="text-slate-400 truncate">${escapeHtml(seq.description)}</div>
        <div class="text-slate-500 text-[10px] mt-1">${getTimeAgo(seq.timestamp)}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load suspicious sequences:', error);
    elements.suspiciousSequences.innerHTML = `
      <div class="text-slate-500 text-center py-2">Failed to analyze</div>
    `;
  }
}

// ============================================
// CHARTS
// ============================================

function initCharts() {
  initTimelineChart();
}

function initTimelineChart() {
  const ctx = elements.timelineChart?.getContext('2d');
  if (!ctx) return;
  
  timelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Actions',
        data: [],
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#fff',
          bodyColor: '#94a3b8',
          borderColor: '#334155',
          borderWidth: 1,
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { 
            color: '#64748b',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#1e293b' },
          ticks: { color: '#64748b' }
        }
      }
    }
  });
}

function updateTimelineChart(byHour) {
  if (!timelineChart || !byHour) return;
  
  const hours = parseInt(elements.timelineRange?.value || '24');
  const now = new Date();
  const labels = [];
  const data = [];
  
  for (let i = hours - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = date.toISOString().substring(0, 13);
    const label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    labels.push(hours <= 48 ? label : date.toLocaleDateString([], { weekday: 'short' }));
    data.push(byHour[key] || 0);
  }
  
  timelineChart.data.labels = labels;
  timelineChart.data.datasets[0].data = data;
  timelineChart.update('none');
}

// ============================================
// ACTIVITY RENDERING
// ============================================

function createActivityElement(item) {
  const div = document.createElement('div');
  div.className = 'activity-item px-4 py-3 hover:bg-slate-800/50 cursor-pointer transition-colors';
  
  const riskClass = getRiskClasses(item.risk?.level);
  const timeAgo = getTimeAgo(item.timestamp);
  const summary = getActivitySummary(item);
  const hasDiff = item.result?.details?.diff;
  const bookmarked = isBookmarked(item.id);
  
  div.innerHTML = `
    <div class="flex items-start gap-3">
      <button class="bookmark-btn ${bookmarked ? 'bookmarked text-yellow-400' : 'text-slate-600'} mt-1" onclick="event.stopPropagation(); toggleBookmark(${JSON.stringify(item).replace(/"/g, '&quot;')})">
        ${bookmarked ? '★' : '☆'}
      </button>
      <div class="flex-1 min-w-0" onclick="showDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="font-medium text-white">${item.tool}</span>
          <span class="text-xs px-2 py-0.5 rounded-full border ${riskClass}">
            ${item.risk?.level || 'unknown'}
          </span>
          ${item.result?.isError ? '<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">Error</span>' : ''}
          ${hasDiff ? '<span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">Has Diff</span>' : ''}
        </div>
        <div class="text-sm text-slate-400 truncate code-block">${escapeHtml(summary)}</div>
        ${item.risk?.flags?.length ? `
          <div class="mt-1 flex flex-wrap gap-1">
            ${item.risk.flags.slice(0, 2).map(f => `
              <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">${escapeHtml(f)}</span>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <span class="text-xs text-slate-500 flex-shrink-0">${timeAgo}</span>
    </div>
  `;
  
  return div;
}

function getRiskClasses(level) {
  const riskColors = {
    low: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
    critical: 'bg-red-600/30 text-red-500 border-red-600/50 font-bold',
  };
  return riskColors[level] || riskColors.low;
}

function getActivitySummary(item) {
  const args = item.arguments || {};
  
  switch (item.tool) {
    case 'exec':
      return args.command || '(no command)';
    case 'read':
    case 'Read':
      return args.path || args.file_path || '(no path)';
    case 'write':
    case 'Write':
      const writePath = args.path || args.file_path || '(no path)';
      const size = args.content?.length || 0;
      return `${writePath} (${formatBytes(size)})`;
    case 'edit':
    case 'Edit':
      return args.path || args.file_path || '(no path)';
    case 'web_fetch':
      return args.url || '(no url)';
    case 'web_search':
      return args.query || '(no query)';
    case 'message':
      return `${args.action || 'send'} → ${args.target || args.channel || '(unknown)'}`;
    case 'browser':
      return `${args.action || 'unknown'} ${args.url || args.targetUrl || ''}`;
    case 'cron':
      return `${args.action || 'unknown'} ${args.jobId || ''}`;
    case 'process':
      return `${args.action || 'unknown'} ${args.sessionId || ''}`;
    default:
      return JSON.stringify(args).substring(0, 100);
  }
}

// ============================================
// MODALS
// ============================================

window.showDetail = function(item) {
  elements.modalTitle.textContent = item.tool;
  
  const timestamp = new Date(item.timestamp).toLocaleString();
  const riskColors = {
    low: 'text-green-400',
    medium: 'text-amber-400',
    high: 'text-red-400',
    critical: 'text-red-500',
  };
  
  const diff = item.result?.details?.diff;
  const diffHtml = diff ? `
    <div>
      <div class="text-sm text-slate-400 mb-2">File Changes:</div>
      <pre class="code-block bg-slate-950 rounded-lg p-4 overflow-x-auto border border-slate-800 text-xs">${formatDiff(diff)}</pre>
    </div>
  ` : '';
  
  elements.modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-4 text-sm flex-wrap">
        <span class="text-slate-400">Time:</span>
        <span class="text-white">${timestamp}</span>
        <span class="text-slate-400">Risk:</span>
        <span class="${riskColors[item.risk?.level] || ''} font-medium">${item.risk?.level || 'unknown'}</span>
        <span class="text-slate-400">Session:</span>
        <span class="text-white font-mono text-xs">${item.sessionId?.substring(0, 8) || 'unknown'}...</span>
      </div>
      
      ${item.risk?.flags?.length ? `
        <div>
          <div class="text-sm text-slate-400 mb-2">Risk Flags:</div>
          <div class="flex flex-wrap gap-2">
            ${item.risk.flags.map(f => `
              <span class="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">${escapeHtml(f)}</span>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div>
        <div class="text-sm text-slate-400 mb-2">Arguments:</div>
        <pre class="code-block bg-slate-950 rounded-lg p-4 overflow-x-auto border border-slate-800">${escapeHtml(JSON.stringify(item.arguments, null, 2))}</pre>
      </div>
      
      ${diffHtml}
      
      ${item.result ? `
        <div>
          <div class="text-sm text-slate-400 mb-2">Result ${item.result.isError ? '(Error)' : ''}:</div>
          <pre class="code-block bg-slate-950 rounded-lg p-4 overflow-x-auto border border-slate-800 ${item.result.isError ? 'text-red-400' : ''}">${escapeHtml(truncateResult(item.result.content))}</pre>
        </div>
      ` : ''}
    </div>
  `;
  
  elements.detailModal.classList.remove('hidden');
  elements.detailModal.classList.add('flex');
};

window.showSequenceDetail = function(seq) {
  elements.modalTitle.textContent = seq.type;
  elements.modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <div class="text-red-400 font-medium mb-2">Suspicious Pattern Detected</div>
        <div class="text-slate-300">${escapeHtml(seq.description)}</div>
      </div>
      
      <div>
        <div class="text-sm text-slate-400 mb-2">Sequence of Actions:</div>
        <div class="space-y-2">
          ${seq.actions.map((action, i) => `
            <div class="flex items-start gap-2">
              <span class="text-slate-500 text-xs w-4">${i + 1}.</span>
              <div class="flex-1">
                <span class="text-white font-medium">${action.tool}</span>
                <span class="text-slate-400 text-xs ml-2">${getTimeAgo(action.timestamp)}</span>
                <div class="text-slate-400 text-xs mt-1 code-block">${escapeHtml(action.summary)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="text-sm text-slate-400">
        <strong>Why this is suspicious:</strong> ${escapeHtml(seq.reason)}
      </div>
    </div>
  `;
  
  elements.detailModal.classList.remove('hidden');
  elements.detailModal.classList.add('flex');
};

window.toggleBookmark = toggleBookmark;

function hideDetail() {
  elements.detailModal.classList.add('hidden');
  elements.detailModal.classList.remove('flex');
}

function hideFileModal() {
  const modal = document.getElementById('file-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  setupTabs();
  
  // Search
  let searchTimeout;
  elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentFilters.search = e.target.value;
      loadActivity();
    }, 300);
  });
  
  // Filters
  elements.categoryFilter.addEventListener('change', (e) => {
    currentFilters.category = e.target.value;
    saveLocalSettings();
    loadActivity();
  });
  
  elements.riskFilter.addEventListener('change', (e) => {
    currentFilters.risk = e.target.value;
    saveLocalSettings();
    loadActivity();
  });
  
  elements.toolFilter?.addEventListener('change', (e) => {
    currentFilters.tool = e.target.value;
    loadActivity();
  });
  
  elements.dateFrom?.addEventListener('change', (e) => {
    currentFilters.dateFrom = e.target.value;
    loadActivity();
  });
  
  elements.dateTo?.addEventListener('change', (e) => {
    currentFilters.dateTo = e.target.value;
    loadActivity();
  });
  
  elements.sessionSelect.addEventListener('change', (e) => {
    currentFilters.session = e.target.value;
    loadActivity();
  });
  
  elements.timelineRange?.addEventListener('change', () => {
    saveLocalSettings();
    loadStats();
  });
  
  // Refresh
  elements.refreshBtn.addEventListener('click', () => {
    loadActivity();
    loadStats();
    loadSuspiciousSequences();
  });
  
  // Load more
  elements.loadMoreBtn.addEventListener('click', () => {
    currentOffset += currentLimit;
    loadActivity(true);
  });
  
  // Modal close
  elements.modalClose.addEventListener('click', hideDetail);
  elements.detailModal.addEventListener('click', (e) => {
    if (e.target === elements.detailModal) hideDetail();
  });
  
  document.getElementById('file-modal-close')?.addEventListener('click', hideFileModal);
  document.getElementById('file-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'file-modal') hideFileModal();
  });
  
  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideDetail();
      hideFileModal();
      hideKillModal();
      hideSettingsModal();
    }
    if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      loadActivity();
      loadStats();
      loadSuspiciousSequences();
    }
  });
  
  // Menu
  const menuBtn = document.getElementById('menu-btn');
  const menuDropdown = document.getElementById('menu-dropdown');
  menuBtn?.addEventListener('click', () => menuDropdown.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!menuBtn?.contains(e.target) && !menuDropdown?.contains(e.target)) {
      menuDropdown?.classList.add('hidden');
    }
  });
  
  // Kill Switch
  setupKillSwitch();
  
  // Settings
  setupSettings();
  
  // Bookmarks
  document.getElementById('clear-bookmarks-btn')?.addEventListener('click', clearAllBookmarks);
  
  // File operations filter
  document.getElementById('file-op-filter')?.addEventListener('change', loadFileOperations);
  
  // Graph refresh
  document.getElementById('graph-refresh-btn')?.addEventListener('click', loadDependencyGraph);
  document.getElementById('graph-session-select')?.addEventListener('change', loadDependencyGraph);
}

function setupKillSwitch() {
  const killSwitchBtn = document.getElementById('kill-switch-btn');
  const killModal = document.getElementById('kill-modal');
  const killConfirmBtn = document.getElementById('kill-confirm-btn');
  const killCancelBtn = document.getElementById('kill-cancel-btn');
  
  killSwitchBtn?.addEventListener('click', () => {
    killModal.classList.remove('hidden');
    killModal.classList.add('flex');
  });
  
  killCancelBtn?.addEventListener('click', hideKillModal);
  killModal?.addEventListener('click', (e) => {
    if (e.target === killModal) hideKillModal();
  });
  
  killConfirmBtn?.addEventListener('click', async () => {
    killConfirmBtn.disabled = true;
    killConfirmBtn.textContent = 'Killing...';
    
    try {
      await fetch('/api/gateway/kill', { method: 'POST' });
      hideKillModal();
      showToast('Kill switch activated - Gateway terminated', 'error');
      checkGatewayStatus();
    } catch (error) {
      showToast('Failed to execute kill switch: ' + error.message, 'error');
    } finally {
      killConfirmBtn.disabled = false;
      killConfirmBtn.textContent = 'Yes, Kill It';
    }
  });
  
  document.getElementById('restart-gateway-btn')?.addEventListener('click', async () => {
    document.getElementById('menu-dropdown')?.classList.add('hidden');
    showToast('Restarting gateway...', 'info');
    
    try {
      await fetch('/api/gateway/restart', { method: 'POST' });
      showToast('Gateway restart initiated', 'success');
      setTimeout(checkGatewayStatus, 3000);
    } catch (error) {
      showToast('Failed to restart: ' + error.message, 'error');
    }
  });
}

function hideKillModal() {
  const killModal = document.getElementById('kill-modal');
  killModal?.classList.add('hidden');
  killModal?.classList.remove('flex');
}

function setupSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsModalClose = document.getElementById('settings-modal-close');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  
  settingsBtn?.addEventListener('click', () => {
    document.getElementById('menu-dropdown')?.classList.add('hidden');
    loadServerSettings();
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex');
  });
  
  settingsModalClose?.addEventListener('click', hideSettingsModal);
  settingsCancelBtn?.addEventListener('click', hideSettingsModal);
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettingsModal();
  });
  
  settingsSaveBtn?.addEventListener('click', saveServerSettings);
  
  document.getElementById('test-streaming-btn')?.addEventListener('click', testStreamingEndpoint);
  document.getElementById('flush-streaming-btn')?.addEventListener('click', flushStreamingBuffer);
}

function hideSettingsModal() {
  const settingsModal = document.getElementById('settings-modal');
  settingsModal?.classList.add('hidden');
  settingsModal?.classList.remove('flex');
  document.getElementById('settings-status').textContent = '';
}

async function loadServerSettings() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    document.getElementById('setting-port').value = config.port || 3847;
    document.getElementById('setting-sessions-path').value = config.sessionsPath || '';
    document.getElementById('settings-config-path').textContent = config.configPath || 'config.json';
    document.getElementById('settings-version').textContent = `v${config.version || '0.3.0'}`;
    
    document.getElementById('setting-alerts-enabled').checked = config.alerts?.enabled || false;
    document.getElementById('setting-webhook-url').value = config.alerts?.webhookUrl || '';
    
    const riskLevels = config.alerts?.onRiskLevels || ['high', 'critical'];
    document.getElementById('setting-alert-critical').checked = riskLevels.includes('critical');
    document.getElementById('setting-alert-high').checked = riskLevels.includes('high');
    document.getElementById('setting-alert-medium').checked = riskLevels.includes('medium');
    document.getElementById('setting-alert-sequences').checked = config.alerts?.onSequences ?? true;
    
    document.getElementById('setting-sequence-window').value = config.detection?.sequenceWindowMinutes || 5;
    document.getElementById('setting-enable-sequences').checked = config.detection?.enableSequenceDetection ?? true;
    
    document.getElementById('setting-timeline-range').value = config.ui?.defaultTimelineRange || 24;
    document.getElementById('setting-activity-limit').value = config.ui?.activityLimit || 50;
    
    await loadStreamingSettings();
  } catch (error) {
    console.error('Failed to load settings:', error);
    showToast('Failed to load settings', 'error');
  }
}

async function loadStreamingSettings() {
  try {
    const res = await fetch('/api/streaming');
    const data = await res.json();
    
    document.getElementById('setting-streaming-enabled').checked = data.config?.enabled || false;
    document.getElementById('setting-streaming-endpoint').value = data.config?.endpoint === '***configured***' ? '' : (data.config?.endpoint || '');
    document.getElementById('setting-streaming-batch').value = data.config?.batchSize || 10;
    document.getElementById('setting-streaming-interval').value = data.config?.flushIntervalMs || 5000;
    
    const statsEl = document.getElementById('streaming-stats');
    if (data.config?.enabled && data.stats) {
      statsEl.classList.remove('hidden');
      statsEl.innerHTML = `
        Sent: ${data.stats.totalSent} | Failed: ${data.stats.totalFailed} | Buffer: ${data.stats.bufferSize}
        ${data.stats.lastSentAt ? `<br>Last: ${new Date(data.stats.lastSentAt).toLocaleTimeString()}` : ''}
        ${data.stats.lastError ? `<br><span class="text-red-400">Error: ${data.stats.lastError}</span>` : ''}
      `;
    } else {
      statsEl.classList.add('hidden');
    }
  } catch (error) {
    console.error('Failed to load streaming settings:', error);
  }
}

async function saveServerSettings() {
  const status = document.getElementById('settings-status');
  const saveBtn = document.getElementById('settings-save-btn');
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  status.textContent = '';
  
  try {
    const onRiskLevels = [];
    if (document.getElementById('setting-alert-critical').checked) onRiskLevels.push('critical');
    if (document.getElementById('setting-alert-high').checked) onRiskLevels.push('high');
    if (document.getElementById('setting-alert-medium').checked) onRiskLevels.push('medium');
    
    const config = {
      port: parseInt(document.getElementById('setting-port').value) || 3847,
      sessionsPath: document.getElementById('setting-sessions-path').value,
      alerts: {
        enabled: document.getElementById('setting-alerts-enabled').checked,
        webhookUrl: document.getElementById('setting-webhook-url').value || null,
        onRiskLevels,
        onSequences: document.getElementById('setting-alert-sequences').checked,
      },
      detection: {
        sequenceWindowMinutes: parseInt(document.getElementById('setting-sequence-window').value) || 5,
        enableSequenceDetection: document.getElementById('setting-enable-sequences').checked,
      },
      ui: {
        defaultTimelineRange: parseInt(document.getElementById('setting-timeline-range').value) || 24,
        activityLimit: parseInt(document.getElementById('setting-activity-limit').value) || 50,
      },
    };
    
    await fetch('/api/streaming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: document.getElementById('setting-streaming-enabled').checked,
        endpoint: document.getElementById('setting-streaming-endpoint').value || null,
        authHeader: document.getElementById('setting-streaming-auth').value || null,
        batchSize: parseInt(document.getElementById('setting-streaming-batch').value) || 10,
        flushIntervalMs: parseInt(document.getElementById('setting-streaming-interval').value) || 5000,
      }),
    });
    
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    
    const data = await res.json();
    
    if (data.success) {
      status.textContent = data.message;
      status.className = 'text-sm text-green-400';
      
      if (data.requiresRestart) {
        showToast('Settings saved! Restart required for some changes.', 'warning');
      } else {
        showToast('Settings saved!', 'success');
      }
      
      currentLimit = config.ui.activityLimit;
      
      setTimeout(hideSettingsModal, 1500);
    } else {
      throw new Error(data.message || 'Failed to save');
    }
  } catch (error) {
    status.textContent = error.message;
    status.className = 'text-sm text-red-400';
    showToast('Failed to save settings', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

async function testStreamingEndpoint() {
  const btn = document.getElementById('test-streaming-btn');
  const endpoint = document.getElementById('setting-streaming-endpoint').value;
  const authHeader = document.getElementById('setting-streaming-auth').value;
  
  if (!endpoint) {
    showToast('Enter an endpoint URL first', 'warning');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Testing...';
  
  try {
    const res = await fetch('/api/streaming/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, authHeader }),
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Endpoint reachable!', 'success');
    } else {
      showToast(`${data.message || 'Test failed'}`, 'error');
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Endpoint';
  }
}

async function flushStreamingBuffer() {
  const btn = document.getElementById('flush-streaming-btn');
  btn.disabled = true;
  btn.textContent = 'Flushing...';
  
  try {
    const res = await fetch('/api/streaming/flush', { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      showToast(`Flushed ${data.flushed} entries`, 'success');
      loadStreamingSettings();
    } else {
      showToast(data.message || 'Flush failed', 'warning');
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Flush Now';
  }
}

// ============================================
// GATEWAY STATUS
// ============================================

async function checkGatewayStatus() {
  const dot = document.getElementById('gateway-dot');
  const text = document.getElementById('gateway-text');
  
  try {
    const res = await fetch('/api/gateway/status');
    const data = await res.json();
    
    if (data.isRunning) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500';
      text.textContent = 'Gateway Running';
      text.className = 'text-green-400';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-red-500';
      text.textContent = 'Gateway Stopped';
      text.className = 'text-red-400';
    }
  } catch (error) {
    dot.className = 'w-2 h-2 rounded-full bg-yellow-500';
    text.textContent = 'Gateway Unknown';
    text.className = 'text-yellow-400';
  }
}

// ============================================
// WEBSOCKET
// ============================================

function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    elements.liveIndicator.querySelector('span:first-child').classList.add('bg-green-500');
    elements.liveIndicator.querySelector('span:first-child').classList.remove('bg-slate-500');
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'update') {
      if (!ws.reloadTimeout) {
        ws.reloadTimeout = setTimeout(() => {
          loadActivity();
          loadStats();
          loadSuspiciousSequences();
          ws.reloadTimeout = null;
        }, 500);
      }
    }
  };
  
  ws.onclose = () => {
    elements.liveIndicator.querySelector('span:first-child').classList.remove('bg-green-500');
    elements.liveIndicator.querySelector('span:first-child').classList.add('bg-slate-500');
    setTimeout(setupWebSocket, 3000);
  };
  
  ws.onerror = (error) => console.error('WebSocket error:', error);
}

// ============================================
// UTILITIES
// ============================================

function formatDiff(diff) {
  if (!diff) return '';
  return escapeHtml(diff)
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<span class="text-green-400">${line}</span>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `<span class="text-red-400">${line}</span>`;
      } else if (line.startsWith('@@')) {
        return `<span class="text-blue-400">${line}</span>`;
      }
      return line;
    })
    .join('\n');
}

function truncateResult(content) {
  if (!content) return '(no output)';
  if (content.length > 5000) {
    return content.substring(0, 5000) + '\n\n... (truncated, ' + formatBytes(content.length) + ' total)';
  }
  return content;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  
  const colors = {
    info: 'bg-blue-600',
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-amber-600',
  };
  
  toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg`;
  toast.textContent = message;
  
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// UPDATE CHECK BANNER
// ============================================

async function checkForUpdate() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    
    if (data.hasUpdate) {
      showUpdateBanner(data.current, data.latest);
    }
  } catch {
    // Silently fail — not critical
  }
}

function showUpdateBanner(current, latest) {
  // Don't show if already dismissed this version
  const dismissed = localStorage.getItem('clawguard-update-dismissed');
  if (dismissed === latest) return;
  
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    background: linear-gradient(135deg, #1e3a5f 0%, #0f2439 100%);
    border-bottom: 1px solid #2563eb;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font-size: 14px;
    color: #e2e8f0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  
  banner.innerHTML = `
    <span style="color: #60a5fa; font-weight: 600;">Update available</span>
    <span>v${current} → v${latest}</span>
    <code style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 12px;">npm update -g @jaydenbeard/clawguard</code>
    <a href="https://github.com/JaydenBeard/clawguard/releases/tag/v${latest}" 
       target="_blank" 
       style="color: #60a5fa; text-decoration: underline; font-size: 13px;">Release notes</a>
    <button id="dismiss-update" style="
      background: none;
      border: 1px solid #475569;
      color: #94a3b8;
      padding: 2px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-left: 8px;
    ">Dismiss</button>
  `;
  
  document.body.prepend(banner);
  
  // Push content down
  document.body.style.paddingTop = banner.offsetHeight + 'px';
  
  document.getElementById('dismiss-update').addEventListener('click', () => {
    localStorage.setItem('clawguard-update-dismissed', latest);
    banner.remove();
    document.body.style.paddingTop = '0';
  });
}

// Start
init();
