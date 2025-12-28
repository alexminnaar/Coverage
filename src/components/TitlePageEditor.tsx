import { useState, useEffect } from 'react';

interface TitlePageData {
  title: string;
  author: string;
  contact: string;
  draftDate: string;
  copyright: string;
  basedOn: string;
}

interface TitlePageEditorProps {
  isOpen: boolean;
  onClose: () => void;
  data: TitlePageData;
  onSave: (data: TitlePageData) => void;
}

export default function TitlePageEditor({
  isOpen,
  onClose,
  data,
  onSave,
}: TitlePageEditorProps) {
  const [formData, setFormData] = useState<TitlePageData>(data);

  useEffect(() => {
    setFormData(data);
  }, [data, isOpen]);

  const handleChange = (field: keyof TitlePageData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content title-page-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Title Page</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Your Screenplay Title"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="author">Written by</label>
            <input
              id="author"
              type="text"
              value={formData.author}
              onChange={(e) => handleChange('author', e.target.value)}
              placeholder="Your Name"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="basedOn">Based on</label>
            <input
              id="basedOn"
              type="text"
              value={formData.basedOn}
              onChange={(e) => handleChange('basedOn', e.target.value)}
              placeholder="(optional) the novel by..."
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="draftDate">Draft Date</label>
              <input
                id="draftDate"
                type="text"
                value={formData.draftDate}
                onChange={(e) => handleChange('draftDate', e.target.value)}
                placeholder="December 2024"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="copyright">Copyright</label>
              <input
                id="copyright"
                type="text"
                value={formData.copyright}
                onChange={(e) => handleChange('copyright', e.target.value)}
                placeholder="© 2024"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label htmlFor="contact">Contact Information</label>
            <textarea
              id="contact"
              value={formData.contact}
              onChange={(e) => handleChange('contact', e.target.value)}
              placeholder="Your address, email, or agent contact..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer title-page-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

