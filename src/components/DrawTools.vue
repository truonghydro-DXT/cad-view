<template>
  <Teleport to="body">
    <div
      v-if="activeTool === 'move'"
      class="draw-tools__move-layer"
      :class="{ 'is-dragging': moveDragging }"
    >
      <div v-if="moveGhost" class="draw-tools__move-ghost" :style="moveGhost" />
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="tableResize.dragging"
      class="draw-tools__table-resize-layer"
      :class="tableResize.cursor === 'col-resize' ? 'is-col' : 'is-row'"
    >
      <div v-if="tableResize.guide" class="draw-tools__table-resize-guide" :style="tableResize.guide" />
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="textEditor.visible && textEditor.mode === 'edit'"
      class="draw-tools__text-popup-mask"
      @mousedown.self="closeTextEditor"
    >
      <div class="draw-tools__text-popup" :style="textPopupStyle" @mousedown.stop>
        <div class="draw-tools__mode-title">
          {{ editingSheetText ? 'Sửa chữ khung mẫu' : 'Sửa chữ' }}
        </div>
        <label class="draw-tools__field draw-tools__field--wide">
          <span>Nội dung</span>
          <input
            ref="textPopupInput"
            v-model="textEditor.contents"
            class="draw-tools__text"
            type="text"
            placeholder="Nhập nội dung chữ..."
            @keydown.enter.prevent="confirmText"
            @keydown.esc.prevent="closeTextEditor"
          />
        </label>
        <label class="draw-tools__field">
          <span>Cỡ chữ (px)</span>
          <input
            v-model.number="textEditor.fontSize"
            class="draw-tools__number"
            type="number"
            min="8"
            max="200"
          />
        </label>
        <label class="draw-tools__field draw-tools__field--wide">
          <span>Màu chữ</span>
          <div class="draw-tools__color-row">
            <input v-model="textEditor.color" class="draw-tools__color" type="color" />
            <input v-model="textEditor.color" class="draw-tools__text" type="text" />
          </div>
        </label>
        <p class="draw-tools__note">Đổi nội dung, cỡ chữ hoặc màu, rồi bấm Cập nhật chữ.</p>
        <div class="draw-tools__actions">
          <el-button @click="closeTextEditor">Hủy</el-button>
          <el-button type="primary" @click="confirmText">Cập nhật chữ</el-button>
        </div>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="tableCellEditor.visible"
      class="draw-tools__text-popup-mask"
      @mousedown.self="closeTableCellEditor"
    >
      <div class="draw-tools__text-popup draw-tools__table-popup" :style="tablePopupStyle" @mousedown.stop>
        <div class="draw-tools__mode-title">
          {{ tableCellEditor.isTitle ? 'Sửa tiêu đề' : `Ô ${tableCellEditor.row + 1} × ${tableCellEditor.col + 1}` }}
        </div>
        <input
          ref="tablePopupInput"
          v-model="tableCellEditor.text"
          class="draw-tools__text"
          type="text"
          placeholder="Nội dung ô..."
          @keydown.enter.prevent="saveTableCell"
          @keydown.esc.prevent="closeTableCellEditor"
        />
        <div class="draw-tools__fields">
          <label class="draw-tools__field">
            <span>Cỡ chữ</span>
            <input
              v-model.number="tableCellEditor.fontSize"
              class="draw-tools__number"
              type="number"
              min="8"
              max="200"
            />
          </label>
          <label class="draw-tools__field">
            <span>Màu</span>
            <label class="draw-tools__check">
              <input type="checkbox" :checked="tableCellColorAuto" @change="onTableCellColorAuto" />
              Tự động
            </label>
            <div v-if="!tableCellColorAuto" class="draw-tools__color-row">
              <input v-model="tableCellEditor.color" class="draw-tools__color" type="color" />
              <input v-model="tableCellEditor.color" class="draw-tools__text" type="text" />
            </div>
          </label>
        </div>
        <div class="draw-tools__table-tools">
          <el-button size="small" @click="addRowAtCell">+ Hàng</el-button>
          <el-button size="small" @click="addColAtCell">+ Cột</el-button>
          <el-button size="small" type="danger" plain @click="removeRowAtCell">− Hàng</el-button>
          <el-button size="small" type="danger" plain @click="removeColAtCell">− Cột</el-button>
        </div>
        <div class="draw-tools__table-merge">
          <label class="draw-tools__table-merge-count">
            <span>Số ô</span>
            <input
              v-model.number="tableCellEditor.mergeCount"
              class="draw-tools__number"
              type="number"
              min="2"
              max="40"
            />
          </label>
          <el-button size="small" @click="mergeRowAtCell">Gộp hàng</el-button>
          <el-button size="small" @click="mergeColAtCell">Gộp cột</el-button>
        </div>
        <el-button
          v-if="tableCellEditor.colSpan > 1 || tableCellEditor.rowSpan > 1"
          class="draw-tools__table-unmerge"
          size="small"
          @click="unmergeAtCell"
        >
          Tách ô
        </el-button>
        <div class="draw-tools__actions draw-tools__actions--split">
          <el-button size="small" @click="closeTableCellEditor">Hủy</el-button>
          <el-button size="small" type="danger" plain :disabled="!tableCellEditor.text.trim()" @click="deleteTableCell">
            Xóa chữ
          </el-button>
          <el-button size="small" type="primary" @click="saveTableCell">Lưu</el-button>
        </div>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="objectMenu.visible"
      class="draw-tools__object-menu-mask"
      @mousedown.self="closeObjectMenu"
    >
      <div class="draw-tools__object-menu" :style="objectMenuStyle" @mousedown.stop>
        <button
          v-if="objectMenu.canCopy"
          type="button"
          class="draw-tools__object-menu-item"
          @click="copyObject"
        >
          Sao chép
        </button>
        <button
          v-if="objectMenu.canPaste"
          type="button"
          class="draw-tools__object-menu-item"
          @click="pasteObject"
        >
          Dán
        </button>
        <button
          v-if="objectMenu.canEditText"
          type="button"
          class="draw-tools__object-menu-item"
          @click="editObjectText"
        >
          Sửa chữ
        </button>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="pasteLayerPicker.visible"
      class="draw-tools__text-popup-mask draw-tools__paste-mask"
      @mousedown.self="closePastePicker"
    >
      <div class="draw-tools__text-popup draw-tools__paste-popup" :style="pastePickerStyle" @mousedown.stop>
        <div class="draw-tools__mode-title">Dán đối tượng</div>
        <p class="draw-tools__note">Chọn lớp để dán bản sao, rồi bấm Dán.</p>
        <LayerPicker :tool="pasteLayerPicker.tool" show-list />
        <div class="draw-tools__actions draw-tools__actions--split">
          <el-button size="small" @click="closePastePicker">Hủy</el-button>
          <el-button size="small" type="primary" :disabled="!store.drawLayer" @click="confirmPaste">
            Dán
          </el-button>
        </div>
      </div>
    </div>
  </Teleport>
  <div class="draw-tools">
    <div class="draw-tools__bar">
      <el-button-group>
        <el-tooltip content="Vẽ điểm: chọn màu, kích thước, tô hoặc trong suốt" placement="bottom">
          <el-button :type="pointPanelVisible || activeTool === 'point' ? 'primary' : 'default'" @click="togglePointPanel">
            <el-icon><Aim /></el-icon>
            Điểm
          </el-button>
        </el-tooltip>
        <el-tooltip content="Vẽ đường: chọn màu và loại nét, rồi click các điểm" placement="bottom">
          <el-button :type="linePanelVisible || activeTool === 'line' ? 'primary' : 'default'" @click="toggleLinePanel">
            <el-icon><Minus /></el-icon>
            Đường
          </el-button>
        </el-tooltip>
        <el-tooltip content="Vẽ vùng: chọn đa giác hoặc hình chữ nhật" placement="bottom">
          <el-button :type="regionPanelVisible || activeTool === 'region' ? 'primary' : 'default'" @click="toggleRegionPanel">
            <el-icon><Crop /></el-icon>
            Vùng
          </el-button>
        </el-tooltip>
        <el-tooltip content="Vẽ hình tròn: click tâm rồi bán kính" placement="bottom">
          <el-button :type="circlePanelVisible || activeTool === 'circle' ? 'primary' : 'default'" @click="toggleCirclePanel">
            <el-icon><CirclePlus /></el-icon>
            Hình tròn
          </el-button>
        </el-tooltip>
        <el-tooltip content="Chọn font, cỡ chữ, góc xoay rồi bấm Vẽ chữ" placement="bottom">
          <el-button :type="textEditor.visible || activeTool === 'text' ? 'primary' : 'default'" @click="toggleTextPanel">
            <el-icon><EditPen /></el-icon>
            Text
          </el-button>
        </el-tooltip>
        <el-tooltip content="Chọn số hàng/cột rồi bấm Vẽ bảng. Sau khi vẽ, kéo cạnh cột hoặc hàng để đổi độ rộng" placement="bottom">
          <el-button :type="tableEditor.visible || activeTool === 'table' ? 'primary' : 'default'" @click="toggleTablePanel">
            <el-icon><Grid /></el-icon>
            Bảng
          </el-button>
        </el-tooltip>
        <el-tooltip content="Tạo lưới: chọn khoảng cách rồi kéo một khung trên bản đồ" placement="bottom">
          <el-button :type="gridPanelVisible || activeTool === 'grid' ? 'primary' : 'default'" @click="toggleGridPanel">
            <el-icon><Operation /></el-icon>
            Lưới
          </el-button>
        </el-tooltip>
        <el-tooltip content="Đặt thước tỷ lệ: chọn hoặc tạo lớp, rồi click vị trí trên bản đồ" placement="bottom">
          <el-button :type="scalePanelVisible || activeTool === 'scale' ? 'primary' : 'default'" @click="toggleScalePanel">
            <el-icon><Odometer /></el-icon>
            Thước tỷ lệ
          </el-button>
        </el-tooltip>
        <el-tooltip content="Khung mẫu địa chính: quét vùng bản đồ để dựng khung, lưới, chú giải, bảng và tỷ lệ" placement="bottom">
          <el-button :type="sheetPanelVisible || activeTool === 'sheet' ? 'primary' : 'default'" @click="toggleSheetPanel">
            <el-icon><FullScreen /></el-icon>
            Khung mẫu
          </el-button>
        </el-tooltip>
      </el-button-group>
    </div>

    <div v-if="linePanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Đường vẽ</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu vẽ</span>
        <div class="draw-tools__color-row">
          <input v-model="store.lineStrokeColor" class="draw-tools__color" type="color" />
          <input v-model="store.lineStrokeColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Loại đường</span>
        <LineTypePicker
          v-model="store.lineLineType"
          :color="store.lineStrokeColor"
          :width="store.lineStrokeWidth"
        />
      </div>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Kích thước đường</span>
        <StrokeWidthPicker v-model="store.lineStrokeWidth" :color="store.lineStrokeColor" />
      </div>
      <LayerPicker tool="line" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startLine">Bắt đầu vẽ</el-button>
      </div>
    </div>

    <div v-if="regionPanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Hình dạng</div>
      <div class="draw-tools__actions draw-tools__actions--split">
        <el-button :type="regionMode === 'polygon' ? 'primary' : 'default'" @click="store.regionMode = 'polygon'">
          Đa giác
        </el-button>
        <el-button :type="regionMode === 'rectangle' ? 'primary' : 'default'" @click="store.regionMode = 'rectangle'">
          Hình chữ nhật
        </el-button>
      </div>

      <div class="draw-tools__mode-title">Nền vùng</div>
      <div class="draw-tools__actions draw-tools__actions--split">
        <el-button :type="regionFillMode === 'fill' ? 'primary' : 'default'" @click="store.regionFillMode = 'fill'">
          Tô màu
        </el-button>
        <el-button
          :type="regionFillMode === 'transparent' ? 'primary' : 'default'"
          @click="store.regionFillMode = 'transparent'"
        >
          Trong suốt
        </el-button>
      </div>

      <label v-if="regionFillMode === 'fill'" class="draw-tools__field draw-tools__field--wide">
        <span>Màu tô</span>
        <div class="draw-tools__color-row">
          <input v-model="store.regionFillColor" class="draw-tools__color" type="color" />
          <input v-model="store.regionFillColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div v-else class="draw-tools__note">Vùng trong suốt, chỉ hiện đường viền.</div>

      <div class="draw-tools__mode-title">Đường viền</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu vẽ</span>
        <div class="draw-tools__color-row">
          <input v-model="store.regionStrokeColor" class="draw-tools__color" type="color" />
          <input v-model="store.regionStrokeColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Loại đường</span>
        <LineTypePicker
          v-model="store.regionLineType"
          :color="store.regionStrokeColor"
          :width="store.regionStrokeWidth"
        />
      </div>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Kích thước đường</span>
        <StrokeWidthPicker v-model="store.regionStrokeWidth" :color="store.regionStrokeColor" />
      </div>
      <LayerPicker tool="region" />

      <div class="draw-tools__actions">
        <el-button type="primary" @click="startRegion(store.regionMode)">Bắt đầu vẽ</el-button>
      </div>
    </div>

    <div v-if="pointPanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Điểm</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu viền</span>
        <div class="draw-tools__color-row">
          <input v-model="store.pointStrokeColor" class="draw-tools__color" type="color" />
          <input v-model="store.pointStrokeColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div class="draw-tools__mode-title">Nền</div>
      <div class="draw-tools__actions draw-tools__actions--split">
        <el-button :type="store.pointFillMode === 'fill' ? 'primary' : 'default'" @click="store.pointFillMode = 'fill'">
          Tô màu
        </el-button>
        <el-button
          :type="store.pointFillMode === 'transparent' ? 'primary' : 'default'"
          @click="store.pointFillMode = 'transparent'"
        >
          Trong suốt
        </el-button>
      </div>
      <label v-if="store.pointFillMode === 'fill'" class="draw-tools__field draw-tools__field--wide">
        <span>Màu tô</span>
        <div class="draw-tools__color-row">
          <input v-model="store.pointFillColor" class="draw-tools__color" type="color" />
          <input v-model="store.pointFillColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div v-else class="draw-tools__note">Điểm trong suốt, chỉ hiện vòng viền.</div>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Kích thước</span>
        <div class="draw-tools__size-row">
          <button
            v-for="item in pointSizes"
            :key="item"
            type="button"
            class="draw-tools__size-item"
            :class="{ 'is-active': store.pointSize === item }"
            :title="`${item} px`"
            @click="store.pointSize = item"
          >
            <span
              class="draw-tools__size-dot"
              :style="{
                width: `${Math.max(6, item / 2)}px`,
                height: `${Math.max(6, item / 2)}px`,
                background: store.pointFillMode === 'fill' ? store.pointFillColor : 'transparent',
                borderColor: store.pointStrokeColor
              }"
            />
            <span>{{ item }}</span>
          </button>
        </div>
      </div>
      <LayerPicker tool="point" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startPoint">Bắt đầu vẽ</el-button>
      </div>
    </div>

    <div v-if="circlePanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Hình tròn</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu viền</span>
        <div class="draw-tools__color-row">
          <input v-model="store.circleStrokeColor" class="draw-tools__color" type="color" />
          <input v-model="store.circleStrokeColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Kích thước đường</span>
        <StrokeWidthPicker v-model="store.circleStrokeWidth" :color="store.circleStrokeColor" />
      </div>
      <div class="draw-tools__mode-title">Nền</div>
      <div class="draw-tools__actions draw-tools__actions--split">
        <el-button :type="store.circleFillMode === 'fill' ? 'primary' : 'default'" @click="store.circleFillMode = 'fill'">
          Tô màu
        </el-button>
        <el-button
          :type="store.circleFillMode === 'transparent' ? 'primary' : 'default'"
          @click="store.circleFillMode = 'transparent'"
        >
          Trong suốt
        </el-button>
      </div>
      <label v-if="store.circleFillMode === 'fill'" class="draw-tools__field draw-tools__field--wide">
        <span>Màu tô</span>
        <div class="draw-tools__color-row">
          <input v-model="store.circleFillColor" class="draw-tools__color" type="color" />
          <input v-model="store.circleFillColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div v-else class="draw-tools__note">Hình tròn trong suốt, chỉ hiện đường viền.</div>
      <LayerPicker tool="circle" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startCircle">Bắt đầu vẽ</el-button>
      </div>
    </div>

    <div v-if="tableEditor.visible" class="draw-tools__panel">
      <div class="draw-tools__fields">
        <label class="draw-tools__field">
          <span>Số hàng</span>
          <input
            v-model.number="tableEditor.rows"
            class="draw-tools__number"
            type="number"
            min="1"
            max="40"
          />
        </label>
        <label class="draw-tools__field">
          <span>Số cột</span>
          <input
            v-model.number="tableEditor.cols"
            class="draw-tools__number"
            type="number"
            min="1"
            max="20"
          />
        </label>
      </div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Tiêu đề (tuỳ chọn)</span>
        <input v-model="tableEditor.title" class="draw-tools__text" type="text" placeholder="Bảng thống kê" />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Tiêu đề cột, cách nhau bởi dấu phẩy</span>
        <input
          v-model="tableEditor.headers"
          class="draw-tools__text"
          type="text"
          placeholder="STT, Hạng mục, Ghi chú"
        />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Font chữ</span>
        <select v-model="tableEditor.font" class="draw-tools__text">
          <option v-for="item in tableFonts" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label class="draw-tools__field">
        <span>Cỡ chữ (px)</span>
        <input
          v-model.number="tableEditor.fontSize"
          class="draw-tools__number"
          type="number"
          min="8"
          max="72"
        />
      </label>
      <p class="draw-tools__note">Chuột phải một ô trên bảng đã vẽ để thêm hoặc xóa hàng/cột. Kéo cạnh cột hoặc hàng để đổi độ rộng. Viền và chữ mặc định tự đổi đen/trắng theo nền bản vẽ, giống khung mẫu.</p>
      <LayerPicker tool="table" />
      <div class="draw-tools__actions">
        <el-button @click="closeTablePanel">Hủy</el-button>
        <el-button type="primary" @click="confirmTable">
          {{ tableEditor.mode === 'edit' ? 'Cập nhật bảng' : 'Vẽ bảng' }}
        </el-button>
      </div>
    </div>

    <div v-if="textEditor.visible && textEditor.mode !== 'edit'" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Vẽ chữ</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Nội dung</span>
        <input
          v-model="textEditor.contents"
          class="draw-tools__text"
          type="text"
          placeholder="Nhập nội dung chữ..."
          @keydown.enter.prevent="confirmText"
        />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Font chữ</span>
        <select v-model="textEditor.font" class="draw-tools__text">
          <option v-for="item in tableFonts" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
      </label>
      <div class="draw-tools__fields">
        <label class="draw-tools__field">
          <span>Cỡ chữ (px)</span>
          <input
            v-model.number="textEditor.fontSize"
            class="draw-tools__number"
            type="number"
            min="8"
            max="72"
          />
        </label>
        <label class="draw-tools__field">
          <span>Xoay (độ)</span>
          <input
            v-model.number="textEditor.rotation"
            class="draw-tools__number"
            type="number"
            step="1"
          />
        </label>
      </div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu chữ</span>
        <div class="draw-tools__color-row">
          <input v-model="textEditor.color" class="draw-tools__color" type="color" />
          <input v-model="textEditor.color" class="draw-tools__text" type="text" />
        </div>
      </label>
      <LayerPicker tool="text" />
      <p class="draw-tools__note">0° nằm ngang. Số dương xoay ngược chiều kim đồng hồ.</p>
      <div class="draw-tools__actions">
        <el-button @click="closeTextEditor">Hủy</el-button>
        <el-button type="primary" @click="confirmText">Vẽ chữ</el-button>
      </div>
    </div>

    <div v-if="gridPanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Tạo lưới</div>
      <p class="draw-tools__note">
        Lưới bám các mốc X/Y của hệ tọa độ bản vẽ đang xem. Kéo một khung trên bản đồ để giới hạn phạm vi.
      </p>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Khoảng cách</span>
        <div class="draw-tools__spacing">
          <button
            v-for="item in gridSpacingPresets"
            :key="item.id"
            type="button"
            class="draw-tools__spacing-item"
            :class="{ 'is-active': store.gridSpacing === item.id }"
            @click="store.gridSpacing = item.id"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <label class="draw-tools__field">
        <span>Khoảng cách tùy chọn</span>
        <input
          :value="store.gridSpacing || ''"
          class="draw-tools__number"
          type="number"
          min="0"
          step="any"
          placeholder="Tự động theo khung"
          @change="onGridSpacingInput"
        />
      </label>
      <label class="draw-tools__check">
        <input v-model="store.gridShowLabels" type="checkbox" />
        Hiện nhãn tọa độ X/Y
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Màu lưới</span>
        <div class="draw-tools__color-row">
          <input v-model="store.gridStrokeColor" class="draw-tools__color" type="color" />
          <input v-model="store.gridStrokeColor" class="draw-tools__text" type="text" />
        </div>
      </label>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Loại đường</span>
        <LineTypePicker
          v-model="store.gridLineType"
          :color="store.gridStrokeColor"
          :width="store.gridStrokeWidth"
        />
      </div>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Kích thước đường</span>
        <StrokeWidthPicker v-model="store.gridStrokeWidth" :color="store.gridStrokeColor" />
      </div>
      <LayerPicker tool="grid" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startGrid">Tạo lưới</el-button>
      </div>
    </div>

    <div v-if="scalePanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Thước tỷ lệ</div>
      <p class="draw-tools__note">
        Độ dài và tỷ lệ 1:N lấy theo bản đồ đang xem. Chọn lớp có sẵn hoặc tạo lớp mới, rồi đặt thước.
      </p>
      <LayerPicker tool="scale" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startScale">Đặt thước tỷ lệ</el-button>
      </div>
    </div>

    <div v-if="sheetPanelVisible" class="draw-tools__panel draw-tools__panel--compact">
      <div class="draw-tools__mode-title">Khung mẫu địa chính</div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Tỉnh / Thành phố</span>
        <input v-model="store.sheetCity" class="draw-tools__text" type="text" placeholder="THÀNH PHỐ HÀ NỘI" />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Tiêu đề</span>
        <input v-model="store.sheetTitle" class="draw-tools__text" type="text" placeholder="BẢN ĐỒ ĐỊA CHÍNH" />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Địa danh (phường / xã)</span>
        <input v-model="store.sheetPlace" class="draw-tools__text" type="text" placeholder="PHƯỜNG LĨNH NAM" />
      </label>
      <div class="draw-tools__fields">
        <label class="draw-tools__field">
          <span>Tờ số</span>
          <input v-model="store.sheetNo" class="draw-tools__text" type="text" placeholder="8" />
        </label>
        <label class="draw-tools__field">
          <span>Tỷ lệ</span>
          <select v-model.number="store.sheetScaleRatio" class="draw-tools__text">
            <option :value="0">Tự động</option>
            <option :value="500">1 : 500</option>
            <option :value="1000">1 : 1 000</option>
            <option :value="2000">1 : 2 000</option>
            <option :value="5000">1 : 5 000</option>
          </select>
        </label>
      </div>
      <div class="draw-tools__field draw-tools__field--wide">
        <span>Khoảng lưới</span>
        <div class="draw-tools__spacing">
          <button
            v-for="item in gridSpacingPresets"
            :key="item.id"
            type="button"
            class="draw-tools__spacing-item"
            :class="{ 'is-active': store.gridSpacing === item.id }"
            @click="store.gridSpacing = item.id"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Đơn vị đo đạc</span>
        <input v-model="store.sheetSurveyUnit" class="draw-tools__text" type="text" />
      </label>
      <label class="draw-tools__field draw-tools__field--wide">
        <span>Cơ quan xác nhận</span>
        <input v-model="store.sheetCertifyUnit" class="draw-tools__text" type="text" />
      </label>
      <LayerPicker tool="sheet" />
      <div class="draw-tools__actions">
        <el-button type="primary" @click="startSheet">Quét vùng trên bản đồ</el-button>
      </div>
    </div>

    <div v-if="hint" class="draw-tools__hint">{{ hint }}</div>
  </div>
</template>

<script setup lang="ts">
import { AcApDocManager, type AcEdCommandEventArgs } from '@mlightcad/cad-simple-viewer'
import { Aim, CirclePlus, Crop, EditPen, FullScreen, Grid, Minus, Odometer, Operation } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  applyTableCellEdit,
  applyTableEdit,
  applyTableInsert,
  applyTableMerge,
  applyTableRemove,
  applyTableUnmerge,
  applyTextEdit,
  beginPointerMove,
  cancelPointerMove,
  startTextEditAtClient,
  startTextEditForAnnotation,
  closeObjectContextMenu,
  closePasteLayerPicker,
  closeTableCellEditor,
  closeTextEditor,
  copyObjectFromMenu,
  beginPasteLayerPick,
  pasteCopiedObject,
  deactivateMoveMode,
  DEFAULT_TABLE_TEXT_COLOR,
  endPointerMove,
  activateLayerForTool,
  GRID_SPACING_PRESETS,
  isAutoTableColor,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  POINT_SIZES,
  setPendingTableOptions,
  setPendingTextOptions,
  TABLE_FONTS,
  updatePointerMove,
  getAnnotation,
  type MoveGhostStyle
} from '../commands'
import { store, type DrawToolId, type RegionDrawMode } from '../store'
import LayerPicker from './LayerPicker.vue'
import LineTypePicker from './LineTypePicker.vue'
import StrokeWidthPicker from './StrokeWidthPicker.vue'

const tableFonts = TABLE_FONTS
const gridSpacingPresets = GRID_SPACING_PRESETS
const pointSizes = POINT_SIZES
const moveDragging = ref(false)
const moveGhost = ref<MoveGhostStyle | null>(null)

const props = defineProps<{
  ready?: boolean
}>()

const tableEditor = computed(() => store.tableEditor)
const tableCellEditor = computed(() => store.tableCellEditor)
const tableResize = computed(() => store.tableResize)
const tableCellColorAuto = computed(() => isAutoTableColor(store.tableCellEditor.color))
const onTableCellColorAuto = (event: Event) => {
  const checked = (event.target as HTMLInputElement).checked
  store.tableCellEditor.color = checked ? DEFAULT_TABLE_TEXT_COLOR : '#000000'
}
const textEditor = computed(() => store.textEditor)
const objectMenu = computed(() => store.objectContextMenu)
const pasteLayerPicker = computed(() => store.pasteLayerPicker)
const editingSheetText = computed(() => store.textEditor.sheetRole != null)
const textPopupInput = ref<HTMLInputElement | null>(null)
const textPopupStyle = computed(() => {
  const width = 360
  const height = 280
  const x = store.textEditor.popupX ?? window.innerWidth / 2
  const y = store.textEditor.popupY ?? window.innerHeight / 2
  return {
    left: `${Math.min(Math.max(12, x), window.innerWidth - width - 12)}px`,
    top: `${Math.min(Math.max(12, y + 12), window.innerHeight - height - 12)}px`
  }
})
const objectMenuStyle = computed(() => ({
  left: `${store.objectContextMenu.x}px`,
  top: `${store.objectContextMenu.y}px`
}))
const pastePickerStyle = computed(() => ({
  left: `${store.pasteLayerPicker.x}px`,
  top: `${store.pasteLayerPicker.y}px`
}))

const closeObjectMenu = () => {
  closeObjectContextMenu()
}

const copyObject = () => {
  copyObjectFromMenu()
}

const pasteObject = () => {
  beginPasteLayerPick()
}

const closePastePicker = () => {
  closePasteLayerPicker()
}

const confirmPaste = () => {
  pasteCopiedObject()
}

const editObjectText = () => {
  const { clickX, clickY, annotationId } = store.objectContextMenu
  const annotation = annotationId ? getAnnotation(annotationId) : undefined
  closeObjectContextMenu()
  if (annotation && startTextEditForAnnotation(annotation, clickX, clickY)) {
    return
  }
  startTextEditAtClient(clickX, clickY)
}

watch(
  () => store.textEditor.visible && store.textEditor.mode === 'edit',
  async (open) => {
    if (!open) {
      return
    }
    await nextTick()
    textPopupInput.value?.focus()
    textPopupInput.value?.select()
  }
)

const tablePopupInput = ref<HTMLInputElement | null>(null)
const tablePopupStyle = computed(() => {
  const width = 380
  const height = 360
  const x = store.tableCellEditor.popupX ?? window.innerWidth / 2
  const y = store.tableCellEditor.popupY ?? window.innerHeight / 2
  return {
    left: `${Math.min(Math.max(12, x), window.innerWidth - width - 12)}px`,
    top: `${Math.min(Math.max(12, y + 12), window.innerHeight - height - 12)}px`
  }
})

watch(
  () => store.tableCellEditor.visible,
  async (open) => {
    if (!open) {
      return
    }
    await nextTick()
    tablePopupInput.value?.focus()
    tablePopupInput.value?.select()
  }
)
const activeTool = computed(() => store.activeDrawTool)
const regionMode = computed(() => store.regionMode)
const regionFillMode = computed(() => store.regionFillMode)
const regionPanelVisible = computed(() => store.regionPanelVisible)
const linePanelVisible = computed(() => store.linePanelVisible)
const gridPanelVisible = computed(() => store.gridPanelVisible)
const pointPanelVisible = computed(() => store.pointPanelVisible)
const circlePanelVisible = computed(() => store.circlePanelVisible)
const sheetPanelVisible = computed(() => store.sheetPanelVisible)
const scalePanelVisible = computed(() => store.scalePanelVisible)
const hint = computed(() => {
  switch (store.activeDrawTool) {
    case 'line':
      return 'Click các điểm để vẽ đường. Click đúp hoặc Enter để kết thúc, Esc để hủy.'
    case 'region':
      return store.regionMode === 'rectangle'
        ? 'Click hai góc để vẽ vùng hình chữ nhật. Esc để hủy.'
        : 'Click các đỉnh đa giác (tối thiểu 3). Click đúp để khép vùng, Esc để hủy.'
    case 'point':
      return 'Click để đặt điểm. Tiếp tục click để thêm điểm khác, Esc để kết thúc.'
    case 'circle':
      return 'Click tâm, rồi click điểm trên vòng tròn. Tiếp tục để vẽ hình khác, Esc để kết thúc.'
    case 'table':
      return 'Click góc thứ nhất, rồi góc đối diện để đặt bảng.'
    case 'text':
      return 'Click vị trí đặt chữ.'
    case 'grid':
      return 'Click hai góc của khung trên bản đồ. Lưới sẽ bám mốc tọa độ X/Y đang xem.'
    case 'scale':
      return 'Click vị trí đặt thước tỷ lệ. Độ dài và 1:N lấy theo tỷ lệ bản đồ đang xem.'
    case 'sheet':
      return 'Click hai góc để quét vùng bản đồ. Khung, lưới tọa độ, chú giải, bảng và tỷ lệ sẽ dựng quanh vùng đó.'
    case 'move':
      return 'Nhấn giữ để kéo. Click đúp để sửa đối tượng. Chuột phải vào chữ để sửa nội dung. Esc để thoát Move.'
    default:
      return store.tableResize.cursor
        ? store.tableResize.cursor === 'col-resize'
          ? 'Kéo cạnh cột để đổi độ rộng.'
          : 'Kéo cạnh hàng để đổi chiều cao.'
        : textEditor.value.visible
        ? editingSheetText.value
          ? 'Sửa nội dung chữ trên khung mẫu, rồi bấm Cập nhật chữ.'
          : textEditor.value.mode === 'edit'
          ? 'Sửa nội dung, font, cỡ chữ, màu hoặc góc xoay, rồi bấm Cập nhật chữ.'
          : 'Chọn font, cỡ chữ, màu, góc xoay, lớp vẽ rồi bấm Vẽ chữ và click vị trí.'
        : tableCellEditor.value.visible
          ? 'Nhập chữ cho ô đang chọn, rồi Lưu hoặc Xóa chữ.'
          : tableEditor.value.mode === 'edit' && tableEditor.value.visible
            ? 'Sửa số hàng/cột rồi bấm Cập nhật bảng. Shift + click đúp bảng để mở khung này. Chuột phải ô để thêm hoặc xóa hàng/cột.'
            : gridPanelVisible.value
              ? 'Chọn khoảng cách rồi bấm Tạo lưới, sau đó kéo một khung trên bản đồ.'
              : sheetPanelVisible.value
                ? 'Điền tiêu đề, tờ số, tỷ lệ rồi bấm Quét vùng trên bản đồ.'
                : scalePanelVisible.value
                  ? 'Chọn hoặc tạo lớp, rồi bấm Đặt thước tỷ lệ và click trên bản đồ.'
                  : pointPanelVisible.value
                ? 'Chọn màu, kích thước, tô hoặc trong suốt, rồi bấm Bắt đầu vẽ và click trên bản đồ.'
                : circlePanelVisible.value
                  ? 'Chọn màu viền, độ dày, tô hoặc trong suốt, rồi bấm Bắt đầu vẽ.'
                  : ''
  }
})

type DrawCommandTool = Exclude<DrawToolId, 'move' | null>

const commandByTool: Record<DrawCommandTool, string> = {
  line: 'drawline',
  region: 'drawregion',
  point: 'drawpoint',
  circle: 'drawcircle',
  table: 'drawtable',
  text: 'drawtext',
  grid: 'drawgrid',
  scale: 'drawscale',
  sheet: 'drawsheet'
}

const hasOpenDocument = () => {
  try {
    return Boolean(props.ready && AcApDocManager.instance?.curDocument)
  } catch {
    return false
  }
}

const closeOtherPanels = () => {
  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  store.linePanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
}

const startTool = (tool: DrawCommandTool) => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  const layer = activateLayerForTool(tool)
  if (!layer.ok) {
    ElMessage.warning(layer.message)
    return
  }

  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
  }
  closeOtherPanels()
  store.activeDrawTool = tool
  AcApDocManager.instance.sendStringToExecute(commandByTool[tool])
}

watch(
  () => store.activeDrawTool,
  (tool) => {
    if (tool !== 'move') {
      moveDragging.value = false
      moveGhost.value = null
      applyMoveCursor('')
      return
    }
    applyMoveCursor('grab')
  }
)

const applyMoveCursor = (cursor: string) => {
  document.body.style.cursor = cursor
  try {
    AcApDocManager.instance.curView.canvas.style.cursor = cursor
  } catch {
    // Canvas cursor is optional.
  }
}

const isOnMoveChrome = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return true
  }
  return Boolean(
    target.closest('.draw-tools') ||
      target.closest('.draw-tools__text-popup') ||
      target.closest('.draw-tools__table-popup') ||
      target.closest('.draw-tools__object-menu') ||
      target.closest('.draw-tools__paste-popup') ||
      target.closest('.viewer-toolbar') ||
      target.closest('.ml-toolbar-button') ||
      target.closest('.ml-vertical-toolbar-container') ||
      target.closest('.el-overlay') ||
      target.closest('.el-popper') ||
      target.closest('.el-message') ||
      target.closest('.el-dialog')
  )
}

const onMovePointerDown = (event: PointerEvent) => {
  if (store.activeDrawTool !== 'move' || moveDragging.value || event.button !== 0) {
    return
  }
  if (isOnMoveChrome(event.target)) {
    return
  }
  if (store.tableCellEditor.visible || store.textEditor.visible) {
    return
  }
  if (!beginPointerMove(event)) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  moveDragging.value = true
  moveGhost.value = updatePointerMove(event)
  applyMoveCursor('grabbing')
  try {
    document.body.setPointerCapture(event.pointerId)
  } catch {
    // Capture is optional while dragging.
  }
}

const onMovePointerMove = (event: PointerEvent) => {
  if (!moveDragging.value) {
    return
  }
  moveGhost.value = updatePointerMove(event)
}

const onMovePointerUp = (event: PointerEvent) => {
  if (!moveDragging.value) {
    return
  }
  endPointerMove(event, true)
  moveDragging.value = false
  moveGhost.value = null
  applyMoveCursor(store.activeDrawTool === 'move' ? 'grab' : '')
}

const onMovePointerCancel = (event: PointerEvent) => {
  endPointerMove(event, false)
  moveDragging.value = false
  moveGhost.value = null
  applyMoveCursor(store.activeDrawTool === 'move' ? 'grab' : '')
}

const onMoveKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && store.tableCellEditor.visible) {
    closeTableCellEditor()
    return
  }
  if (event.key === 'Escape' && store.textEditor.visible && store.activeDrawTool !== 'text') {
    closeTextEditor()
    return
  }
  if (event.key !== 'Escape' || store.activeDrawTool !== 'move') {
    return
  }
  cancelPointerMove()
  moveDragging.value = false
  moveGhost.value = null
  deactivateMoveMode()
}

const closeLinePanel = () => {
  store.linePanelVisible = false
}

const toggleLinePanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.linePanelVisible = !store.linePanelVisible
}

const startLine = () => {
  store.linePanelVisible = false
  startTool('line')
}

const toggleRegionPanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  closeLinePanel()
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.regionPanelVisible = !store.regionPanelVisible
}

const startRegion = (mode: RegionDrawMode) => {
  store.regionMode = mode
  store.regionPanelVisible = false
  startTool('region')
}

const togglePointPanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  closeLinePanel()
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.circlePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.pointPanelVisible = !store.pointPanelVisible
}

const startPoint = () => {
  store.pointPanelVisible = false
  startTool('point')
}

const toggleCirclePanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  closeLinePanel()
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.pointPanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.circlePanelVisible = !store.circlePanelVisible
}

const startCircle = () => {
  store.circlePanelVisible = false
  startTool('circle')
}

const closeTablePanel = () => {
  store.tableEditor.visible = false
  store.tableEditor.mode = 'create'
  store.tableEditor.annotationId = null
  store.tableEditor.sheetTableRole = null
}

const saveTableCell = () => {
  applyTableCellEdit(
    store.tableCellEditor.text,
    store.tableCellEditor.color,
    store.tableCellEditor.fontSize
  )
}

const deleteTableCell = () => {
  applyTableCellEdit('', store.tableCellEditor.color)
}

const addRowAtCell = () => {
  applyTableInsert('row')
}

const addColAtCell = () => {
  applyTableInsert('col')
}

const removeRowAtCell = () => {
  applyTableRemove('row')
}

const removeColAtCell = () => {
  applyTableRemove('col')
}

const mergeRowAtCell = () => {
  applyTableMerge('row')
}

const mergeColAtCell = () => {
  applyTableMerge('col')
}

const unmergeAtCell = () => {
  applyTableUnmerge()
}

const toggleTablePanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  if (store.tableEditor.visible) {
    closeTablePanel()
    return
  }

  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  closeLinePanel()
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.tableEditor.visible = true
  store.tableEditor.mode = 'create'
  store.tableEditor.annotationId = null
  store.tableEditor.sheetTableRole = null
}

const readTableOptions = () => {
  const rows = Math.max(1, Math.min(MAX_TABLE_ROWS, Math.round(Number(store.tableEditor.rows) || 1)))
  const cols = Math.max(1, Math.min(MAX_TABLE_COLS, Math.round(Number(store.tableEditor.cols) || 1)))
  store.tableEditor.rows = rows
  store.tableEditor.cols = cols
  const fontSize = Math.max(8, Math.min(72, Math.round(Number(store.tableEditor.fontSize) || 14)))
  store.tableEditor.fontSize = fontSize
  return {
    rows,
    cols,
    title: store.tableEditor.title,
    headers: store.tableEditor.headers
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    font: store.tableEditor.font,
    fontSize
  }
}

const confirmTable = () => {
  const options = readTableOptions()
  if (store.tableEditor.mode === 'edit') {
    applyTableEdit(options)
    closeTablePanel()
    return
  }

  setPendingTableOptions(options)
  closeTablePanel()
  startTool('table')
}

const toggleTextPanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  if (store.textEditor.visible) {
    closeTextEditor()
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  store.regionPanelVisible = false
  closeLinePanel()
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.textEditor.visible = true
  store.textEditor.mode = 'create'
  store.textEditor.annotationId = null
  store.textEditor.sheetRole = null
  store.textEditor.popupX = null
  store.textEditor.popupY = null
}

const readTextOptions = () => {
  const fontSize = Math.max(8, Math.min(200, Math.round(Number(store.textEditor.fontSize) || 20)))
  const rotation = Number(store.textEditor.rotation)
  store.textEditor.fontSize = fontSize
  store.textEditor.rotation = Number.isFinite(rotation) ? rotation : 0
  return {
    contents: store.textEditor.contents.trim(),
    font: store.textEditor.font,
    fontSize,
    rotation: store.textEditor.rotation,
    color: store.textEditor.color
  }
}

const confirmText = () => {
  const options = readTextOptions()
  if (!options.contents && store.textEditor.sheetRole == null) {
    ElMessage.warning('Hãy nhập nội dung chữ.')
    return
  }

  if (store.textEditor.mode === 'edit') {
    applyTextEdit(options)
    closeTextEditor()
    return
  }

  setPendingTextOptions(options)
  closeTextEditor()
  startTool('text')
}

const closeGridPanel = () => {
  store.gridPanelVisible = false
}

const toggleGridPanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  if (store.gridPanelVisible) {
    closeGridPanel()
    return
  }

  closeTablePanel()
  closeTableCellEditor()
  closeTextEditor()
  store.regionPanelVisible = false
  closeLinePanel()
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    store.activeDrawTool = null
  }
  store.gridPanelVisible = true
}

const onGridSpacingInput = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  store.gridSpacing = Number.isFinite(value) && value > 0 ? value : 0
}

const startGrid = () => {
  const spacing = Number(store.gridSpacing)
  store.gridSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 0
  closeGridPanel()
  startTool('grid')
}

const startScale = () => {
  store.scalePanelVisible = false
  startTool('scale')
}

const toggleScalePanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  if (store.scalePanelVisible) {
    store.scalePanelVisible = false
    return
  }

  closeOtherPanels()
  store.scalePanelVisible = true
}

const toggleSheetPanel = () => {
  if (!hasOpenDocument()) {
    ElMessage.warning('Hãy mở bản vẽ trước khi vẽ.')
    return
  }

  if (store.sheetPanelVisible) {
    store.sheetPanelVisible = false
    return
  }

  closeOtherPanels()
  store.sheetPanelVisible = true
}

const startSheet = () => {
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  startTool('sheet')
}

const DRAW_COMMAND_NAMES = new Set([
  'drawline',
  'drawregion',
  'drawpoint',
  'drawcircle',
  'drawtable',
  'drawtext',
  'drawgrid',
  'drawscale',
  'drawsheet'
])

const onCommandEnded = (args: AcEdCommandEventArgs) => {
  const name = args.command.globalName?.toLowerCase()
  if (name && DRAW_COMMAND_NAMES.has(name)) {
    store.activeDrawTool = null
  }
}

let unbind: (() => void) | null = null

const bindEditorEvents = () => {
  const editor = AcApDocManager.instance?.editor
  if (!editor || unbind) {
    return
  }

  editor.events.commandEnded.addEventListener(onCommandEnded)
  unbind = () => {
    editor.events.commandEnded.removeEventListener(onCommandEnded)
    unbind = null
  }
}

watch(
  () => props.ready,
  (ready) => {
    if (ready) {
      bindEditorEvents()
    }
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', onMoveKeyDown)
  document.addEventListener('pointerdown', onMovePointerDown, true)
  document.addEventListener('pointermove', onMovePointerMove, true)
  document.addEventListener('pointerup', onMovePointerUp, true)
  document.addEventListener('pointercancel', onMovePointerCancel, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMoveKeyDown)
  document.removeEventListener('pointerdown', onMovePointerDown, true)
  document.removeEventListener('pointermove', onMovePointerMove, true)
  document.removeEventListener('pointerup', onMovePointerUp, true)
  document.removeEventListener('pointercancel', onMovePointerCancel, true)
  applyMoveCursor('')
  unbind?.()
  cancelPointerMove()
  store.activeDrawTool = null
})
</script>

<style scoped>
.draw-tools {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 1300;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  margin-left: 0;
  transform: translateX(-50%);
}

.draw-tools__bar,
.draw-tools__hint,
.draw-tools__panel {
  pointer-events: auto;
}

.draw-tools__bar {
  max-width: 92vw;
}

.draw-tools__bar :deep(.el-button-group) {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.draw-tools__panel {
  width: min(420px, 92vw);
  padding: 12px;
  border-radius: 8px;
  background: #fff;
  color: #303133;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.draw-tools__text-popup-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  pointer-events: auto;
}

.draw-tools__object-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 4100;
  pointer-events: auto;
}

.draw-tools__object-menu {
  position: fixed;
  z-index: 4101;
  min-width: 160px;
  padding: 4px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
}

.draw-tools__object-menu-item {
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #303133;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.draw-tools__object-menu-item:hover {
  background: #ecf5ff;
  color: #409eff;
}

.draw-tools__text-popup {
  position: fixed;
  z-index: 4001;
  width: min(360px, calc(100vw - 24px));
  padding: 12px;
  border-radius: 10px;
  background: #fff;
  color: #303133;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}

.draw-tools__paste-mask {
  z-index: 4200;
}

.draw-tools__paste-popup {
  max-height: calc(100vh - 24px);
  overflow: auto;
  z-index: 4201;
}

.draw-tools__table-popup {
  width: min(380px, calc(100vw - 24px));
  padding: 10px;
  gap: 8px;
}

.draw-tools__table-popup :deep(.el-button) {
  margin: 0;
}

.draw-tools__table-popup :deep(.el-button + .el-button) {
  margin-left: 0;
}

.draw-tools__table-tools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.draw-tools__table-merge {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 8px;
  align-items: center;
}

.draw-tools__table-merge-count {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
}

.draw-tools__table-merge-count .draw-tools__number {
  width: 56px;
  flex: 0 0 56px;
}

.draw-tools__table-tools :deep(.el-button),
.draw-tools__table-merge :deep(.el-button),
.draw-tools__table-unmerge,
.draw-tools__table-popup .draw-tools__actions :deep(.el-button) {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding-left: 8px;
  padding-right: 8px;
}

.draw-tools__table-unmerge {
  width: 100%;
}

.draw-tools__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.draw-tools__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.draw-tools__field--wide {
  width: 100%;
}

.draw-tools__number,
.draw-tools__text {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 32px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 0 8px;
  font-size: 14px;
  color: #303133;
  background: #fff;
}

.draw-tools__number:focus,
.draw-tools__text:focus {
  outline: none;
  border-color: #409eff;
}

.draw-tools__panel--compact {
  width: min(360px, 92vw);
}

.draw-tools__mode-title {
  font-size: 13px;
  font-weight: 600;
}

.draw-tools__color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.draw-tools__color {
  width: 40px;
  height: 32px;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
}

.draw-tools__size-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

.draw-tools__size-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  height: 44px;
  padding: 4px 2px 3px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 11px;
  cursor: pointer;
}

.draw-tools__size-item:hover {
  border-color: #c0c4cc;
  background: #f5f7fa;
}

.draw-tools__size-item.is-active {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff inset;
  background: #ecf5ff;
  color: #409eff;
}

.draw-tools__size-dot {
  border: 2px solid #382418;
  border-radius: 50%;
  box-sizing: border-box;
}

.draw-tools__spacing {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.draw-tools__spacing-item {
  height: 28px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #303133;
  font-size: 12px;
  cursor: pointer;
}

.draw-tools__spacing-item:hover {
  border-color: #c0c4cc;
  background: #f5f7fa;
}

.draw-tools__spacing-item.is-active {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff inset;
  background: #ecf5ff;
  color: #409eff;
}

.draw-tools__check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.draw-tools__note {
  font-size: 12px;
  color: #606266;
}

.draw-tools__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.draw-tools__actions--split {
  justify-content: stretch;
}

.draw-tools__actions--split :deep(.el-button) {
  flex: 1;
}

.draw-tools__hint {
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.92);
  color: #303133;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  max-width: min(720px, 80vw);
  text-align: center;
}

.draw-tools__move-layer {
  position: fixed;
  inset: 0;
  z-index: 1180;
  cursor: grab;
  pointer-events: none;
}

.draw-tools__move-layer.is-dragging {
  cursor: grabbing;
  pointer-events: auto;
}

.draw-tools__move-ghost {
  position: fixed;
  border: 2px dashed #409eff;
  background: rgba(64, 158, 255, 0.12);
  pointer-events: none;
}

.draw-tools__table-resize-layer {
  position: fixed;
  inset: 0;
  z-index: 1190;
  pointer-events: none;
}

.draw-tools__table-resize-layer.is-col {
  cursor: col-resize;
}

.draw-tools__table-resize-layer.is-row {
  cursor: row-resize;
}

.draw-tools__table-resize-guide {
  position: fixed;
  background: #409eff;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.35);
}
</style>
