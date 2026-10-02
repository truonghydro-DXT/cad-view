export default {
  main: {
    exportPdf: {
      tooltip: {
        title: 'Tuy chon xuat PDF',
        buttonText: 'Nhan nut',
        fileName: 'Ten file mac dinh',
        canvasSelector: 'Bo chon canvas'
      }
    }
  },
  command: {
    ACAD: {
      quit: {
        description: 'Exits the application and closes all open drawings'
      },
      exit: {
        description: 'Exits the application and closes all open drawings'
      },
      drawline: {
        description: 'Draw a polyline by clicking points'
      },
      drawregion: {
        description: 'Draw a filled region by clicking vertices'
      },
      drawtable: {
        description: 'Draw a table by picking two corners'
      },
      drawtext: {
        description: 'Draw text at a clicked location'
      }
    }
  }
}
