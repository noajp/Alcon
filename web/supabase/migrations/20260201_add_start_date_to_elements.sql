-- Add start_date column to elements table for Gantt view scheduling
-- This column stores the start date for elements, enabling Gantt chart visualization
-- alongside the existing due_date (end date) column

ALTER TABLE elements ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

COMMENT ON COLUMN elements.start_date IS 'Start date for Gantt view - when the element work begins';
