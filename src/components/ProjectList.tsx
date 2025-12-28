import { ProjectMeta } from '../types';

interface ProjectListProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectMeta[];
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

export default function ProjectList({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onNewProject,
  onDeleteProject,
}: ProjectListProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content project-list-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Your Screenplays</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <button className="new-project-btn" onClick={onNewProject}>
            <span className="new-icon">+</span>
            New Screenplay
          </button>
          
          <div className="project-grid">
            {projects.length === 0 ? (
              <div className="no-projects">
                <p>No screenplays yet.</p>
                <p className="hint">Click "New Screenplay" to get started.</p>
              </div>
            ) : (
              projects.map((project) => (
                <div 
                  key={project.id}
                  className={`project-card ${project.id === currentProjectId ? 'active' : ''}`}
                  onClick={() => onSelectProject(project.id)}
                >
                  <div className="project-card-header">
                    <h3 className="project-title">{project.title || 'Untitled'}</h3>
                    <button 
                      className="project-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                      title="Delete screenplay"
                    >
                      ×
                    </button>
                  </div>
                  <p className="project-author">
                    {project.author ? `by ${project.author}` : 'by Anonymous'}
                  </p>
                  <div className="project-meta">
                    <span className="project-pages">{project.pageCount} {project.pageCount === 1 ? 'page' : 'pages'}</span>
                    <span className="project-date">{formatDate(project.updatedAt)}</span>
                  </div>
                  {project.id === currentProjectId && (
                    <div className="current-badge">Current</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

