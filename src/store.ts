import { reactive } from 'vue'

import { DEFAULT_STROKE_WIDTH, type RegionLineTypeId } from './commands/lineTypes'
import { DEFAULT_TABLE_TEXT_COLOR } from './commands/tableCmd'
import {
  DEFAULT_TABLE_FONT,
  DEFAULT_TABLE_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE
} from './commands/textStyles'

export type DrawToolId =
  | 'line'
  | 'region'
  | 'point'
  | 'circle'
  | 'table'
  | 'text'
  | 'grid'
  | 'scale'
  | 'sheet'
  | 'move'
  | null
export type RegionDrawMode = 'polygon' | 'rectangle'
export type RegionFillMode = 'fill' | 'transparent'
export type { RegionLineTypeId }

export type TableEditorState = {
  visible: boolean
  mode: 'create' | 'edit'
  annotationId: string | null
  sheetTableRole: 'note' | 'legend' | null
  rows: number
  cols: number
  title: string
  headers: string
  font: string
  fontSize: number
}

export type TextEditorState = {
  visible: boolean
  mode: 'create' | 'edit'
  annotationId: string | null
  sheetRole: string | null
  contents: string
  font: string
  fontSize: number
  rotation: number
  color: string
  popupX: number | null
  popupY: number | null
}

export type TableCellEditorState = {
  visible: boolean
  annotationId: string | null
  sheetTableRole: 'note' | 'legend' | null
  row: number
  col: number
  text: string
  color: string
  fontSize: number
  isTitle: boolean
  mergeCount: number
  colSpan: number
  rowSpan: number
  popupX: number | null
  popupY: number | null
}

export type TableResizeGuideStyle = {
  left: string
  top: string
  width: string
  height: string
}

export type TableResizeState = {
  dragging: boolean
  cursor: 'col-resize' | 'row-resize' | ''
  guide: TableResizeGuideStyle | null
}

export type ObjectContextMenuState = {
  visible: boolean
  x: number
  y: number
  clickX: number
  clickY: number
  worldX: number
  worldY: number
  annotationId: string | null
  canCopy: boolean
  canPaste: boolean
  canEditText: boolean
}

export type PasteLayerPickerState = {
  visible: boolean
  x: number
  y: number
  worldX: number
  worldY: number
  tool: 'point' | 'line' | 'region' | 'text' | 'sheet' | 'table' | 'scale'
}

export const store = reactive<{
  selectedFile: File | null
  activeDrawTool: DrawToolId
  regionMode: RegionDrawMode
  regionFillMode: RegionFillMode
  regionFillColor: string
  regionStrokeColor: string
  regionLineType: RegionLineTypeId
  regionStrokeWidth: number
  regionPanelVisible: boolean
  lineStrokeColor: string
  lineLineType: RegionLineTypeId
  lineStrokeWidth: number
  linePanelVisible: boolean
  pointStrokeColor: string
  pointFillMode: RegionFillMode
  pointFillColor: string
  pointSize: number
  pointPanelVisible: boolean
  circleStrokeColor: string
  circleStrokeWidth: number
  circleFillMode: RegionFillMode
  circleFillColor: string
  circlePanelVisible: boolean
  tableEditor: TableEditorState
  tableCellEditor: TableCellEditorState
  tableResize: TableResizeState
  objectContextMenu: ObjectContextMenuState
  pasteLayerPicker: PasteLayerPickerState
  textEditor: TextEditorState
  gridPanelVisible: boolean
  gridSpacing: number
  gridShowLabels: boolean
  gridStrokeColor: string
  gridLineType: RegionLineTypeId
  gridStrokeWidth: number
  sheetPanelVisible: boolean
  sheetCity: string
  sheetTitle: string
  sheetPlace: string
  sheetNo: string
  sheetScaleRatio: number
  sheetSurveyUnit: string
  sheetCertifyUnit: string
  sheetColor: string
  scalePanelVisible: boolean
  drawLayer: string
}>({
  selectedFile: null,
  activeDrawTool: null,
  regionMode: 'polygon',
  regionFillMode: 'fill',
  regionFillColor: '#382418',
  regionStrokeColor: '#382418',
  regionLineType: 'Continuous',
  regionStrokeWidth: DEFAULT_STROKE_WIDTH,
  regionPanelVisible: false,
  lineStrokeColor: '#382418',
  lineLineType: 'Continuous',
  lineStrokeWidth: DEFAULT_STROKE_WIDTH,
  linePanelVisible: false,
  pointStrokeColor: '#382418',
  pointFillMode: 'fill',
  pointFillColor: '#382418',
  pointSize: 16,
  pointPanelVisible: false,
  circleStrokeColor: '#382418',
  circleStrokeWidth: DEFAULT_STROKE_WIDTH,
  circleFillMode: 'transparent',
  circleFillColor: '#382418',
  circlePanelVisible: false,
  tableEditor: {
    visible: false,
    mode: 'create',
    annotationId: null,
    sheetTableRole: null,
    rows: 4,
    cols: 3,
    title: '',
    headers: '',
    font: DEFAULT_TABLE_FONT,
    fontSize: DEFAULT_TABLE_FONT_SIZE
  },
  tableCellEditor: {
    visible: false,
    annotationId: null,
    sheetTableRole: null,
    row: 0,
    col: 0,
    text: '',
    color: DEFAULT_TABLE_TEXT_COLOR,
    fontSize: DEFAULT_TABLE_FONT_SIZE,
    isTitle: false,
    mergeCount: 2,
    colSpan: 1,
    rowSpan: 1,
    popupX: null,
    popupY: null
  },
  tableResize: {
    dragging: false,
    cursor: '',
    guide: null
  },
  objectContextMenu: {
    visible: false,
    x: 0,
    y: 0,
    clickX: 0,
    clickY: 0,
    worldX: 0,
    worldY: 0,
    annotationId: null,
    canCopy: false,
    canPaste: false,
    canEditText: false
  },
  pasteLayerPicker: {
    visible: false,
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0,
    tool: 'text'
  },
  textEditor: {
    visible: false,
    mode: 'create',
    annotationId: null,
    sheetRole: null,
    contents: '',
    font: DEFAULT_TABLE_FONT,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    rotation: 0,
    color: DEFAULT_TEXT_COLOR,
    popupX: null,
    popupY: null
  },
  gridPanelVisible: false,
  gridSpacing: 0,
  gridShowLabels: true,
  gridStrokeColor: '#382418',
  gridLineType: 'Continuous',
  gridStrokeWidth: 1,
  sheetPanelVisible: false,
  sheetCity: 'THÀNH PHỐ HÀ NỘI',
  sheetTitle: 'BẢN ĐỒ ĐỊA CHÍNH',
  sheetPlace: '',
  sheetNo: '1',
  sheetScaleRatio: 500,
  sheetSurveyUnit: 'Đơn vị đo đạc',
  sheetCertifyUnit: 'Cơ quan xác nhận',
  sheetColor: '#000000',
  scalePanelVisible: false,
  drawLayer: ''
})
