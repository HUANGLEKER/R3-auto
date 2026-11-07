import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string = string> {
    value: T;
    label: string;
    dot?: string;
    count?: number;
    description?: string;
    disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
    id?: string;
    name?: string;
    value: T;
    onChange: (value: T) => void;
    options: SelectOption<T>[];
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    triggerClassName?: string;
    menuClassName?: string;
    size?: 'sm' | 'md';
    align?: 'left' | 'right';
    placement?: 'bottom' | 'top';
    showCheck?: boolean;
    colorScheme?: 'emerald' | 'indigo' | 'slate';
    ariaLabel?: string;
    title?: string;
}

export function Select<T extends string = string>({
    id,
    name,
    value,
    onChange,
    options,
    placeholder = '请选择',
    disabled = false,
    className = '',
    triggerClassName = '',
    menuClassName = '',
    size = 'sm',
    align = 'left',
    placement = 'bottom',
    showCheck = true,
    colorScheme = 'emerald',
    ariaLabel,
    title,
}: SelectProps<T>): React.ReactElement {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const autoId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const selectId = id || `select-${autoId}`;

    const selectedOption = options.find(opt => opt.value === value);

    // Close on outside click or touch
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    // Reset highlighted index when opened
    useEffect(() => {
        if (isOpen) {
            const idx = options.findIndex(opt => opt.value === value);
            setHighlightedIndex(idx >= 0 ? idx : 0);
        } else {
            setHighlightedIndex(-1);
        }
    }, [isOpen, options, value]);

    // Scroll active item into view when navigating with keyboard
    useEffect(() => {
        if (isOpen && highlightedIndex >= 0 && menuRef.current) {
            const el = document.getElementById(`${selectId}-opt-${highlightedIndex}`);
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [isOpen, highlightedIndex, selectId]);

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;

        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                triggerRef.current?.focus();
                break;
            case 'ArrowDown': {
                e.preventDefault();
                setHighlightedIndex(prev => {
                    let next = prev + 1;
                    while (next < options.length && options[next].disabled) next++;
                    return next < options.length ? next : prev;
                });
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                setHighlightedIndex(prev => {
                    let next = prev - 1;
                    while (next >= 0 && options[next].disabled) next--;
                    return next >= 0 ? next : prev;
                });
                break;
            }
            case 'Enter':
            case ' ': {
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < options.length) {
                    const opt = options[highlightedIndex];
                    if (!opt.disabled) {
                        onChange(opt.value);
                        setIsOpen(false);
                        triggerRef.current?.focus();
                    }
                }
                break;
            }
            case 'Tab':
                setIsOpen(false);
                break;
        }
    };

    // Style tokens by colorScheme
    const schemeStyles = {
        emerald: {
            focusRing: 'focus:ring-emerald-500/20 focus:border-emerald-500',
            activeChevron: 'text-emerald-500',
            selectedOption: 'bg-emerald-50/80 text-emerald-700 font-semibold',
            checkIcon: 'text-emerald-600',
        },
        indigo: {
            focusRing: 'focus:ring-indigo-500/20 focus:border-indigo-500',
            activeChevron: 'text-indigo-500',
            selectedOption: 'bg-indigo-50/80 text-indigo-700 font-semibold',
            checkIcon: 'text-indigo-600',
        },
        slate: {
            focusRing: 'focus:ring-slate-400/20 focus:border-slate-400',
            activeChevron: 'text-slate-600',
            selectedOption: 'bg-slate-100 text-slate-800 font-semibold',
            checkIcon: 'text-slate-700',
        },
    }[colorScheme];

    const sizeStyles = {
        sm: 'px-2.5 py-1 text-xs gap-2',
        md: 'px-3 py-1.5 text-xs gap-2.5',
    }[size];

    return (
        <div ref={containerRef} className={`relative inline-block ${isOpen ? 'z-30' : ''} ${className}`} onKeyDown={handleKeyDown}>
            {/* Hidden native select for automated test compatibility and form integration */}
            <select
                id={selectId}
                name={name}
                value={value}
                onChange={e => onChange(e.target.value as T)}
                disabled={disabled}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 w-full h-full opacity-0 pointer-events-none -z-10"
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                        {opt.label}
                    </option>
                ))}
            </select>

            {/* Modern Custom Dropdown Trigger */}
            <button
                ref={triggerRef}
                type="button"
                onClick={() => !disabled && setIsOpen(prev => !prev)}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label={ariaLabel}
                title={title}
                className={`flex items-center justify-between rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 transition-all cursor-pointer shadow-2xs hover:border-slate-400 focus:outline-none focus:ring-2 select-none ${schemeStyles.focusRing} ${sizeStyles} ${
                    disabled ? 'opacity-50 cursor-not-allowed pointer-events-none bg-slate-50 border-slate-200 shadow-none' : ''
                } ${triggerClassName}`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {selectedOption?.dot && (
                        <span className={`w-2 h-2 rounded-full ${selectedOption.dot} shrink-0`} />
                    )}
                    <span className="font-medium truncate">
                        {selectedOption?.label ?? placeholder}
                    </span>
                    {selectedOption?.count !== undefined && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-semibold">
                            {selectedOption.count}
                        </span>
                    )}
                </div>

                <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                        isOpen ? `rotate-180 ${schemeStyles.activeChevron}` : ''
                    }`}
                />
            </button>

            {/* Custom Dropdown Menu Popover */}
            {isOpen && (
                <div
                    ref={menuRef}
                    role="listbox"
                    aria-activedescendant={highlightedIndex >= 0 ? `${selectId}-opt-${highlightedIndex}` : undefined}
                    className={`absolute z-50 min-w-full max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100 ${
                        placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                    } ${
                        align === 'right' ? 'right-0' : 'left-0'
                    } ${menuClassName}`}
                >
                    {options.map((opt, idx) => {
                        const isSelected = value === opt.value;
                        const isHighlighted = highlightedIndex === idx;

                        return (
                            <button
                                key={opt.value}
                                id={`${selectId}-opt-${idx}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={opt.disabled}
                                onClick={() => {
                                    if (opt.disabled) return;
                                    onChange(opt.value);
                                    setIsOpen(false);
                                    triggerRef.current?.focus();
                                }}
                                onMouseEnter={() => setHighlightedIndex(idx)}
                                className={`w-full px-3 py-1.5 flex items-center justify-between text-xs transition-colors cursor-pointer text-left ${
                                    opt.disabled
                                        ? 'opacity-40 cursor-not-allowed'
                                        : isSelected
                                          ? schemeStyles.selectedOption
                                          : isHighlighted
                                            ? 'bg-slate-100 text-slate-900'
                                            : 'text-slate-700 hover:bg-slate-100'
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {opt.dot && (
                                        <span className={`w-2 h-2 rounded-full ${opt.dot} shrink-0`} />
                                    )}
                                    <div className="flex flex-col min-w-0">
                                        <span className="truncate">{opt.label}</span>
                                        {opt.description && (
                                            <span className="text-[10px] text-slate-400 font-normal truncate">
                                                {opt.description}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                    {opt.count !== undefined && opt.count > 0 && (
                                        <span className="text-[10px] font-mono text-slate-400">
                                            {opt.count}
                                        </span>
                                    )}
                                    {showCheck && isSelected && (
                                        <Check className={`w-3.5 h-3.5 ${schemeStyles.checkIcon}`} />
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
