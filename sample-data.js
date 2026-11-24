// Sample gauges are generated relative to today so each calibration state stays useful in a demo.
window.GaugeSampleData = {
  make() {
    const addDays = (days) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    return [
      {
        id: "G-1042",
        name: "Digital Micrometer",
        serialNumber: "DM-88421",
        category: "Dimensional",
        lastCalibrationDate: addDays(-335),
        nextCalibrationDate: addDays(60),
        location: "Tool Room A",
        checkout: null
      },
      {
        id: "G-2087",
        name: "Vernier Caliper",
        serialNumber: "VC-19204",
        category: "Dimensional",
        lastCalibrationDate: addDays(-350),
        nextCalibrationDate: addDays(10),
        location: "Quality Lab",
        checkout: {
          borrower: "Alex Morgan",
          department: "Production",
          expectedReturnDate: addDays(2),
          checkedOutAt: new Date().toISOString()
        }
      },
      {
        id: "G-3315",
        name: "Pressure Gauge",
        serialNumber: "PG-76103",
        category: "Pressure",
        lastCalibrationDate: addDays(-410),
        nextCalibrationDate: addDays(-45),
        location: "Assembly Line 2",
        checkout: null
      }
    ];
  }
};
