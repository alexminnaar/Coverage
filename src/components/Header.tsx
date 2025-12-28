import { useState, useRef, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  Sun,
  Moon,
  Maximize,
  Minimize,
  Sparkles,
  Settings,
  HelpCircle,
  FileText,
  LayoutGrid,
  FolderOpen,
  FilePlus,
  Upload,
  Download,
  FileDown,
  ChevronDown,
  Clapperboard,
  History,
  Hash,
  Lock,
  Unlock,
  Layers,
  Printer,
  MessageSquare,
  Clock,
  AlignCenter,
  Eye,
  Users,
  GitCompare,
  Target,
} from 'lucide-react';

interface HeaderProps {
  title: string;
  author: string;
  pageCount: number;
  onTitleChange: (title: string) => void;
  onAuthorChange: (author: string) => void;
  onExportPDF: () => void;
  onExportFountain: () => void;
  onNew: () => void;
  onShowHelp: () => void;
  onShowProjects: () => void;
  onShowTitlePage: () => void;
  onShowStatistics: () => void;
  onShowBeatBoard: () => void;
  onShowSnapshots: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onImport?: (file: File) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  distractionFree: boolean;
  onToggleDistractionFree: () => void;
  aiEnabled: boolean;
  onToggleAIChat: () => void;
  onShowAISettings: () => void;
  showAIChat: boolean;
  // Scene numbering
  sceneNumberingEnabled?: boolean;
  scenesLocked?: boolean;
  onToggleSceneNumbering?: () => void;
  onToggleScenesLocked?: () => void;
  // Revisions
  onShowRevisions?: () => void;
  currentRevisionColor?: string;
  // New features
  onShowPrintPreview?: () => void;
  onShowNotesPanel?: () => void;
  onExportFdx?: () => void;
  showNotesPanel?: boolean;
  totalDuration?: string;
  // Typewriter & Focus modes
  typewriterMode?: boolean;
  focusMode?: boolean;
  onToggleTypewriterMode?: () => void;
  onToggleFocusMode?: () => void;
  // Writing goals
  onShowWritingGoals?: () => void;
  goalProgress?: { current: number; target: number; type: string };
  // Character tracker
  onShowCharacterTracker?: () => void;
  // Scene compare
  onShowSceneCompare?: () => void;
}

export default function Header({
  title,
  author,
  pageCount,
  onTitleChange,
  onAuthorChange,
  onExportPDF,
  onExportFountain,
  onNew,
  onShowHelp,
  onShowProjects,
  onShowTitlePage,
  onShowStatistics,
  onShowBeatBoard,
  onShowSnapshots,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onImport,
  theme,
  onToggleTheme,
  distractionFree,
  onToggleDistractionFree,
  aiEnabled,
  onToggleAIChat,
  onShowAISettings,
  showAIChat,
  sceneNumberingEnabled,
  scenesLocked,
  onToggleSceneNumbering,
  onToggleScenesLocked,
  onShowRevisions,
  currentRevisionColor,
  onShowPrintPreview,
  onShowNotesPanel,
  onExportFdx,
  showNotesPanel,
  totalDuration,
  typewriterMode,
  focusMode,
  onToggleTypewriterMode,
  onToggleFocusMode,
  onShowWritingGoals,
  goalProgress,
  onShowCharacterTracker,
  onShowSceneCompare,
}: HeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingAuthor, setIsEditingAuthor] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImport) {
      onImport(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setShowFileMenu(false);
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="logo" onClick={onShowProjects} title="View all screenplays">
          <Clapperboard size={22} className="logo-icon" />
          <span className="logo-text">Screenwriter</span>
        </button>

        <div className="header-divider" />

        <div className="header-toolbar">
          <button 
            className="toolbar-btn" 
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
          >
            <Undo2 size={18} />
          </button>
          <button 
            className="toolbar-btn" 
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
          >
            <Redo2 size={18} />
          </button>
        </div>

        <div className="header-divider" />

        {/* File Menu */}
        <div className="dropdown" ref={fileMenuRef}>
          <button 
            className={`dropdown-trigger ${showFileMenu ? 'active' : ''}`}
            onClick={() => { setShowFileMenu(!showFileMenu); setShowToolsMenu(false); }}
          >
            <span>File</span>
            <ChevronDown size={16} />
          </button>
          {showFileMenu && (
            <div className="dropdown-menu">
              <button onClick={() => { onNew(); setShowFileMenu(false); }}>
                <FilePlus size={18} />
                <span>New Screenplay</span>
                <kbd>⌘N</kbd>
              </button>
              <button onClick={() => { onShowProjects(); setShowFileMenu(false); }}>
                <FolderOpen size={18} />
                <span>Open Project</span>
              </button>
              <div className="dropdown-divider" />
              {onImport && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".fountain,.txt"
                    onChange={handleFileChange}
                    className="import-input"
                  />
                  <button onClick={() => fileInputRef.current?.click()}>
                    <Upload size={18} />
                    <span>Import Fountain</span>
                  </button>
                </>
              )}
              <button onClick={() => { onExportPDF(); setShowFileMenu(false); }}>
                <FileDown size={18} />
                <span>Export PDF</span>
              </button>
              <button onClick={() => { onExportFountain(); setShowFileMenu(false); }}>
                <Download size={18} />
                <span>Export Fountain</span>
              </button>
              {onExportFdx && (
                <button onClick={() => { onExportFdx(); setShowFileMenu(false); }}>
                  <Download size={18} />
                  <span>Export Final Draft (.fdx)</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tools Menu */}
        <div className="dropdown" ref={toolsMenuRef}>
          <button 
            className={`dropdown-trigger ${showToolsMenu ? 'active' : ''}`}
            onClick={() => { setShowToolsMenu(!showToolsMenu); setShowFileMenu(false); }}
          >
            <span>Tools</span>
            <ChevronDown size={16} />
          </button>
          {showToolsMenu && (
            <div className="dropdown-menu">
              <button onClick={() => { onShowTitlePage(); setShowToolsMenu(false); }}>
                <FileText size={18} />
                <span>Title Page</span>
              </button>
              <button onClick={() => { onShowBeatBoard(); setShowToolsMenu(false); }}>
                <LayoutGrid size={18} />
                <span>Beat Board</span>
              </button>
              <div className="dropdown-divider" />
              {onShowPrintPreview && (
                <button onClick={() => { onShowPrintPreview(); setShowToolsMenu(false); }}>
                  <Printer size={18} />
                  <span>Print Preview</span>
                </button>
              )}
              <button onClick={() => { onShowSnapshots(); setShowToolsMenu(false); }}>
                <History size={18} />
                <span>Snapshots</span>
              </button>
              <button onClick={() => { onShowStatistics(); setShowToolsMenu(false); }}>
                <FileText size={18} />
                <span>Statistics</span>
              </button>
              {onShowWritingGoals && (
                <button onClick={() => { onShowWritingGoals(); setShowToolsMenu(false); }}>
                  <Target size={18} />
                  <span>Writing Goals</span>
                </button>
              )}
              {onShowCharacterTracker && (
                <button onClick={() => { onShowCharacterTracker(); setShowToolsMenu(false); }}>
                  <Users size={18} />
                  <span>Character Tracker</span>
                </button>
              )}
              {onShowSceneCompare && (
                <button onClick={() => { onShowSceneCompare(); setShowToolsMenu(false); }}>
                  <GitCompare size={18} />
                  <span>Compare Versions</span>
                </button>
              )}
              <div className="dropdown-divider" />
              {onToggleSceneNumbering && (
                <button onClick={() => { onToggleSceneNumbering(); setShowToolsMenu(false); }}>
                  <Hash size={18} />
                  <span>{sceneNumberingEnabled ? 'Hide Scene Numbers' : 'Show Scene Numbers'}</span>
                </button>
              )}
              {onToggleScenesLocked && sceneNumberingEnabled && (
                <button onClick={() => { onToggleScenesLocked(); setShowToolsMenu(false); }}>
                  {scenesLocked ? <Unlock size={18} /> : <Lock size={18} />}
                  <span>{scenesLocked ? 'Unlock Scene Numbers' : 'Lock Scene Numbers'}</span>
                </button>
              )}
              {onShowRevisions && (
                <>
                  <div className="dropdown-divider" />
                  <button onClick={() => { onShowRevisions(); setShowToolsMenu(false); }}>
                    <Layers size={18} />
                    <span>Revisions</span>
                    {currentRevisionColor && (
                      <span 
                        className="revision-indicator"
                        style={{ 
                          background: currentRevisionColor,
                          width: 12, 
                          height: 12, 
                          borderRadius: '50%',
                          marginLeft: 'auto'
                        }}
                      />
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="header-center">
        <div className="title-section">
          {isEditingTitle ? (
            <input
              type="text"
              className="title-input"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
              autoFocus
              placeholder="Untitled Screenplay"
            />
          ) : (
            <h1 
              className="title-display" 
              onClick={() => setIsEditingTitle(true)}
              title="Click to edit"
            >
              {title || 'Untitled Screenplay'}
            </h1>
          )}
          
          {isEditingAuthor ? (
            <input
              type="text"
              className="author-input"
              value={author}
              onChange={(e) => onAuthorChange(e.target.value)}
              onBlur={() => setIsEditingAuthor(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingAuthor(false)}
              autoFocus
              placeholder="Your Name"
            />
          ) : (
            <span 
              className="author-display" 
              onClick={() => setIsEditingAuthor(true)}
              title="Click to edit"
            >
              {author ? `by ${author}` : 'by Anonymous'}
            </span>
          )}
        </div>
      </div>

      <div className="header-right">
        <button 
          className="page-count-badge" 
          onClick={onShowStatistics}
          title="View statistics"
        >
          <span className="page-number">{pageCount}</span>
          <span className="page-label">{pageCount === 1 ? 'page' : 'pages'}</span>
        </button>

        {totalDuration && (
          <div className="duration-badge" title="Estimated runtime">
            <Clock size={16} />
            <span>{totalDuration}</span>
          </div>
        )}

        {/* Writing Goals Progress */}
        {goalProgress && onShowWritingGoals && (
          <button 
            className={`writing-goals-badge ${goalProgress.current >= goalProgress.target ? 'goal-met' : ''}`}
            onClick={onShowWritingGoals}
            title="Writing Goals"
          >
            <span className="goal-text">
              <strong>{goalProgress.current}</strong>/{goalProgress.target} {goalProgress.type}
            </span>
          </button>
        )}

        <div className="header-divider" />
        
        <div className="header-actions">
          {/* Focus Mode Toggles */}
          {(onToggleTypewriterMode || onToggleFocusMode) && (
            <div className="focus-toggle-group">
              {onToggleTypewriterMode && (
                <button
                  className={`focus-toggle-btn ${typewriterMode ? 'active' : ''}`}
                  onClick={onToggleTypewriterMode}
                  title="Typewriter Mode (⌘⇧T)"
                >
                  <AlignCenter size={16} />
                </button>
              )}
              {onToggleFocusMode && (
                <button
                  className={`focus-toggle-btn ${focusMode ? 'active' : ''}`}
                  onClick={onToggleFocusMode}
                  title="Focus Mode - Dim unfocused text"
                >
                  <Eye size={16} />
                </button>
              )}
            </div>
          )}

          {/* AI Toggle */}
          <div className="ai-toggle-group">
            <button 
              className={`toolbar-btn ai-btn ${showAIChat ? 'active' : ''} ${aiEnabled ? '' : 'disabled'}`}
              onClick={onToggleAIChat}
              title={aiEnabled ? "Toggle AI Chat (⌘/)" : "AI disabled"}
            >
              <Sparkles size={18} />
            </button>
            <button 
              className="toolbar-btn-sm" 
              onClick={onShowAISettings}
              title="AI Settings"
            >
              <Settings size={14} />
            </button>
          </div>

          {onShowNotesPanel && (
            <button 
              className={`toolbar-btn ${showNotesPanel ? 'active' : ''}`}
              onClick={onShowNotesPanel}
              title="Script Notes"
            >
              <MessageSquare size={18} />
            </button>
          )}

          <div className="header-divider" />

          <button 
            className="toolbar-btn" 
            onClick={onToggleTheme}
            title={`Theme: ${theme}`}
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          
          <button 
            className="toolbar-btn" 
            onClick={onToggleDistractionFree}
            title="Focus mode (F11)"
          >
            {distractionFree ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          
          <button 
            className="toolbar-btn" 
            onClick={onShowHelp}
            title="Help (?)"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
