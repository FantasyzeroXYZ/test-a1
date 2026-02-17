
import React, { useState, useEffect } from 'react';
import { Language, TableEntry } from '../types';
import { getTranslation } from '../utils/i18n';
import { downloadFile, formatTime } from '../utils/parsers';

interface VocabListModalProps {
    isOpen: boolean;
    onClose: () => void;
    language: Language;
    onUpdate: () => void; // Callback to trigger app update if needed
}

const ITEMS_PER_PAGE = 15;

export const VocabListModal: React.FC<VocabListModalProps> = ({ isOpen, onClose, language, onUpdate }) => {
    const t = getTranslation(language);
    const [entries, setEntries] = useState<TableEntry[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<TableEntry>>({});

    useEffect(() => {
        if (isOpen) {
            loadEntries();
        }
    }, [isOpen]);

    const loadEntries = () => {
        try {
            const raw = localStorage.getItem('lf_vocab_table');
            const data: TableEntry[] = raw ? JSON.parse(raw) : [];
            // Sort by addedAt descending (newest first)
            data.sort((a, b) => b.addedAt - a.addedAt);
            setEntries(data);
        } catch (e) {
            console.error("Failed to load vocab table", e);
            setEntries([]);
        }
    };

    const saveEntries = (newEntries: TableEntry[]) => {
        localStorage.setItem('lf_vocab_table', JSON.stringify(newEntries));
        // Ensure list is re-sorted after potential edit
        newEntries.sort((a, b) => b.addedAt - a.addedAt);
        setEntries(newEntries);
        onUpdate();
    };

    const handleDelete = (id: string) => {
        if (confirm(t.deleteEntryConfirm)) {
            const newEntries = entries.filter(e => e.id !== id);
            saveEntries(newEntries);
        }
    };

    const handleClearAll = () => {
        if (confirm(t.clearAllVocabConfirm)) {
            saveEntries([]);
            setCurrentPage(1);
        }
    };

    const handleExportCSV = () => {
        if (entries.length === 0) {
            alert(t.listEmpty);
            return;
        }

        const header = ["Word", "Definition", "Sentence", "Translation", "Tags", "Source", "Time Range", "Date"];
        const csvRows = [header.join(',')];

        // Use the full, sorted list for export
        entries.forEach(row => {
            const cols = [
                `"${(row.word || '').replace(/"/g, '""')}"`,
                `"${(row.definition || '').replace(/"/g, '""')}"`,
                `"${(row.sentence || '').replace(/"/g, '""')}"`,
                `"${(row.translation || '').replace(/"/g, '""')}"`,
                `"${(row.tags || '').replace(/"/g, '""')}"`,
                `"${(row.sourceTitle || '').replace(/"/g, '""')}"`,
                `"${(row.timeRange || '').replace(/"/g, '""')}"`,
                `"${new Date(row.addedAt).toLocaleString()}"`
            ];
            csvRows.push(cols.join(','));
        });

        const csvContent = csvRows.join('\n');
        downloadFile(csvContent, `vocab_export_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    };

    const startEdit = (entry: TableEntry) => {
        setEditingId(entry.id);
        setEditForm({ ...entry });
    };

    const saveEdit = () => {
        if (!editingId) return;
        const newEntries = entries.map(e => e.id === editingId ? { ...e, ...editForm } : e);
        saveEntries(newEntries);
        setEditingId(null);
        setEditForm({});
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({});
    };

    // Pagination Logic
    const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
    const paginatedEntries = entries.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    const nextPage = () => setCurrentPage(p => Math.min(p + 1, totalPages));
    const prevPage = () => setCurrentPage(p => Math.max(p - 1, 1));

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-bounce-in border border-gray-200 dark:border-slate-700">
                
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <i className="fa-solid fa-table text-emerald-500"></i> {t.vocabTable}
                        <span className="text-xs font-normal text-slate-500 bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">{t.nItems.replace('{count}', String(entries.length))}</span>
                    </h2>
                    <div className="flex gap-2">
                        <button onClick={handleExportCSV} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded flex items-center gap-1">
                            <i className="fa-solid fa-file-csv"></i> {t.exportCSV}
                        </button>
                        <button onClick={handleClearAll} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-xs font-bold rounded">
                            {t.clearAll}
                        </button>
                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-full">
                            <i className="fa-solid fa-xmark text-lg"></i>
                        </button>
                    </div>
                </div>

                {/* List Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-100 dark:bg-black/20">
                    {entries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <i className="fa-solid fa-box-open text-4xl mb-4 opacity-30"></i>
                            <p>{t.noVocab}</p>
                        </div>
                    ) : (
                        paginatedEntries.map(entry => (
                            <div key={entry.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm relative group">
                                {editingId === entry.id ? (
                                    <div className="space-y-3 p-2">
                                        <input 
                                            value={editForm.word || ''} 
                                            onChange={e => setEditForm({...editForm, word: e.target.value})}
                                            className="w-full p-2 text-sm border rounded dark:bg-slate-700 dark:border-slate-600 dark:text-white font-bold"
                                            placeholder={t.placeholderWord}
                                        />
                                        <textarea 
                                            value={editForm.definition || ''} 
                                            onChange={e => setEditForm({...editForm, definition: e.target.value})}
                                            className="w-full p-2 text-sm border rounded dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                                            rows={5}
                                            placeholder={t.placeholderDefinition}
                                        />
                                        <div className="flex justify-end gap-2">
                                            <button onClick={cancelEdit} className="px-3 py-1 text-xs text-slate-500">{t.cancel}</button>
                                            <button onClick={saveEdit} className="px-3 py-1 bg-emerald-600 text-white text-xs rounded">{t.save}</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-between items-center">
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-base font-bold text-indigo-600 dark:text-indigo-400 truncate">{entry.word}</h3>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">
                                                    <i className="fa-solid fa-calendar-alt mr-1"></i>
                                                    {new Date(entry.addedAt).toLocaleDateString()}
                                                </span>
                                                <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded truncate">
                                                    <i className="fa-solid fa-music mr-1"></i>
                                                    {entry.sourceTitle}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => startEdit(entry)} className="p-2 text-slate-400 hover:text-amber-500"><i className="fa-solid fa-pencil"></i></button>
                                            <button onClick={() => handleDelete(entry.id)} className="p-2 text-slate-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="p-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 flex justify-between items-center">
                        <button onClick={prevPage} disabled={currentPage === 1} className="px-3 py-1 bg-gray-100 dark:bg-slate-700 rounded disabled:opacity-50 text-xs">{t.previous}</button>
                        <span className="text-xs text-slate-500">{t.pageIndicator.replace('{current}', String(currentPage)).replace('{total}', String(totalPages))}</span>
                        <button onClick={nextPage} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-100 dark:bg-slate-700 rounded disabled:opacity-50 text-xs">{t.next}</button>
                    </div>
                )}
            </div>
        </div>
    );
};
