; Inno Setup script for LaptopTracker
[Setup]
AppName=LaptopTracker
AppVersion=1.0.0
DefaultDirName={pf}\LaptopTracker
DefaultGroupName=LaptopTracker
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
Compression=lzma
SolidCompression=yes

[Files]
 Source: "..\dist3\TrackerClient\TrackerClient.exe"; DestDir: "{app}"; Flags: ignoreversion
 Source: "..\dist3\TrackerClient\appsettings.json"; DestDir: "{app}"; Flags: ignoreversion
 Source: "..\dist3\TrackerClient\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
 ; Run for all users on login (best for location access in user session)
 Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LaptopTracker"; ValueData: """{app}\TrackerClient.exe"""; Flags: uninsdeletevalue

[Run]
 ; Run immediately after install (hidden)
 Filename: "{app}\TrackerClient.exe"; StatusMsg: "Starting LaptopTracker..."; Flags: runhidden nowait

[Code]
var
  PageConfig: TWizardPage;
  LabelName: TLabel;
  EditName: TEdit;
  LabelDept: TLabel;
  EditDept: TEdit;

procedure InitializeWizard;
begin
  PageConfig := CreateCustomPage(wpSelectDir, 'LaptopTracker Configuration', 'Enter the Employee Name and Department.');

  // Name
  LabelName := TLabel.Create(PageConfig);
  LabelName.Parent := PageConfig.Surface;
  LabelName.Caption := 'Employee Name:';
  LabelName.Top := 0;
  
  EditName := TEdit.Create(PageConfig);
  EditName.Parent := PageConfig.Surface;
  EditName.Top := LabelName.Top + LabelName.Height + 6;
  EditName.Width := PageConfig.SurfaceWidth;
  EditName.Text := '';

  // Department
  LabelDept := TLabel.Create(PageConfig);
  LabelDept.Parent := PageConfig.Surface;
  LabelDept.Caption := 'Department:';
  LabelDept.Top := EditName.Top + EditName.Height + 12;
  
  EditDept := TEdit.Create(PageConfig);
  EditDept.Parent := PageConfig.Surface;
  EditDept.Top := LabelDept.Top + LabelDept.Height + 6;
  EditDept.Width := PageConfig.SurfaceWidth;
  EditDept.Text := '';
end;

function UpdateJsonConfig(const FilePath, Name, Dept: string): boolean;
var
  NewJson: string;
begin
  try
    NewJson :=
      '{' + #13#10 +
      '  "BackendBaseUrl": "http://202.4.116.106:4000/api",' + #13#10 +
      '  "EmployeeCode": "",' + #13#10 +
      '  "ClientToken": "dev_client_token",' + #13#10 +
      '  "IntervalSeconds": 15,' + #13#10 +
      '  "EmployeeName": "' + Name + '",' + #13#10 +
      '  "DepartmentName": "' + Dept + '"' + #13#10 +
      '}';
    SaveStringToFile(FilePath, NewJson, False);
    Result := True;
  except
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  CfgPath: string;
begin
  if CurStep = ssPostInstall then
  begin
    // Update config before the [Run] section executes
    CfgPath := ExpandConstant('{app}\appsettings.json');
    UpdateJsonConfig(CfgPath, EditName.Text, EditDept.Text);
  end;
end;
