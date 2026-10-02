export default {
  main: {
    exportPdf: {
      tooltip: {
        title: 'PDF 导出设置',
        buttonText: '按钮文本',
        fileName: '默认文件名',
        canvasSelector: '画布选择器'
      }
    }
  },
  command: {
    ACAD: {
      quit: {
        description: '退出应用程序并关闭所有打开的图纸'
      },
      exit: {
        description: '退出应用程序并关闭所有打开的图纸'
      },
      drawline: {
        description: '通过点击点绘制折线'
      },
      drawregion: {
        description: '通过点击顶点绘制填充区域'
      },
      drawtable: {
        description: '通过指定两个角点绘制表格'
      },
      drawtext: {
        description: '在点击位置绘制文字'
      }
    }
  }
}
