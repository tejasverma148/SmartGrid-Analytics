import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Dependency-free tests for profile logic, C++ analytics, APIs, editable data and static assets. */
public class SmartGridTests {
    private static int passed=0, failed=0;
    private static void check(String name, boolean ok) { if(ok){passed++;System.out.println("[PASS] "+name);}else{failed++;System.out.println("[FAIL] "+name);} }
    public static void main(String[] args) throws Exception {
        String cppExe="out"+File.separator+(System.getProperty("os.name").toLowerCase().contains("win")?"analytics.exe":"analytics");
        Process cpp=new ProcessBuilder(new File(cppExe).getAbsolutePath()).start();
        try(BufferedWriter w=new BufferedWriter(new OutputStreamWriter(cpp.getOutputStream(),StandardCharsets.UTF_8))){w.write("1000|1800|100,200,300,400");w.newLine();}
        String cppOut=new String(cpp.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
        check("C++ configurable threshold input",cpp.waitFor()==0&&cppOut.contains("averagePowerW\":250.00")&&cppOut.contains("normalThresholdW\":1000"));
        Process badCpp=new ProcessBuilder(new File(cppExe).getAbsolutePath()).start();
        try(BufferedWriter w=new BufferedWriter(new OutputStreamWriter(badCpp.getOutputStream(),StandardCharsets.UTF_8))){w.write("1800|1000|100,200");w.newLine();}
        badCpp.getInputStream().readAllBytes();check("C++ rejects invalid threshold order",badCpp.waitFor()!=0);
        Process badReading=new ProcessBuilder(new File(cppExe).getAbsolutePath()).start();
        try(BufferedWriter w=new BufferedWriter(new OutputStreamWriter(badReading.getOutputStream(),StandardCharsets.UTF_8))){w.write("1000|1800|-5,abc");w.newLine();}
        badReading.getInputStream().readAllBytes();check("C++ rejects malformed power readings",badReading.waitFor()!=0);

        int port=18081;
        Process server=new ProcessBuilder(javaCommand(),"-Dsmartgrid.port="+port,"-cp","out","SmartGridServer").redirectErrorStream(true).start();
        try {
            HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            String base="http://127.0.0.1:"+port;boolean up=false;
            for(int i=0;i<50;i++){try{HttpResponse<String> r=send(client,base+"/api/health","GET");if(r.statusCode()==200){up=true;break;}}catch(Exception ignored){}Thread.sleep(120);}
            check("server health endpoint",up);
            if(up){
                HttpResponse<String> health=send(client,base+"/api/health","GET");check("reports version 7.0",health.body().contains("7.0"));
                HttpResponse<String> campus=send(client,base+"/api/state","GET");check("campus profile includes broad area coverage",campus.statusCode()==200&&campus.body().contains("Computer Labs")&&campus.body().contains("Hostels & Student Housing")&&campus.body().contains("Auditorium & Events")&&campus.body().contains("Common Areas & Corridors"));
                check("area equipment shares are returned",campus.body().contains("Desktop workstations")&&campus.body().contains("\"share\":58"));
                HttpResponse<String> campusAnalytics=send(client,base+"/api/analytics","GET");check("Java to C++ analytics integration",campusAnalytics.statusCode()==200&&campusAnalytics.body().contains("averagePowerW")&&campusAnalytics.body().contains("normalThresholdW"));
                HttpResponse<String> homeSwitch=send(client,base+"/api/profile?id=home","POST");check("switch to residential profile",homeSwitch.statusCode()==200&&homeSwitch.body().contains("Residential / Home")&&homeSwitch.body().contains("Living Room")&&homeSwitch.body().contains("Kitchen"));
                double before=extractNumber(homeSwitch.body(),"dailyUnitsKWh");
                HttpResponse<String> areaEdit=send(client,base+"/api/area?id=kitchen&dailyKWh=7.5&peakW=2500&thresholdW=2200","POST");double after=extractNumber(areaEdit.body(),"dailyUnitsKWh");check("editing an area recalculates property energy",areaEdit.statusCode()==200&&after>before&&Math.abs(after-(before+2.6))<0.02);
                check("editable area peak and threshold are retained",areaEdit.body().contains("\"peakW\":2500")&&areaEdit.body().contains("\"thresholdW\":2200")&&areaEdit.body().contains("AREA THRESHOLD EXCEEDED"));
                HttpResponse<String> settings=send(client,base+"/api/settings?tariff=9.5&normal=4500&overload=7000","POST");check("tariff and thresholds are editable",settings.statusCode()==200&&settings.body().contains("\"tariffPerKWh\":9.50")&&settings.body().contains("\"normalThresholdW\":4500"));
                HttpResponse<String> settingsAnalytics=send(client,base+"/api/analytics","GET");check("C++ receives selected profile thresholds",settingsAnalytics.statusCode()==200&&settingsAnalytics.body().contains("normalThresholdW\":4500")&&settingsAnalytics.body().contains("overloadThresholdW\":7000"));
                check("trend and next-sample estimate are calculated",settingsAnalytics.statusCode()==200&&settingsAnalytics.body().contains("forecastNextW")&&settingsAnalytics.body().contains("\"trend\":\""));
                double billBefore=extractNumber(settings.body(),"monthlyBill");HttpResponse<String> manual=send(client,base+"/api/simulate?watts=1200&hours=8","POST");double billAfter=extractNumber(manual.body(),"monthlyBill");check("manual simulated load adds energy and recalculates bill",manual.statusCode()==200&&manual.body().contains("Manual additional load")&&manual.body().contains("Simulated additional load")&&Math.abs(extractNumber(manual.body(),"manualExtraKWh")-9.6)<0.02&&billAfter>billBefore);
                HttpResponse<String> manualAnalytics=send(client,base+"/api/analytics","GET");check("manual load changes C++ analytics results",manualAnalytics.statusCode()==200&&manualAnalytics.body().contains("\"high\":"));
                HttpResponse<String> spike=send(client,base+"/api/scenario?mode=Power%20Spike","POST");check("scenario controls regenerate demand readings",spike.statusCode()==200&&spike.body().contains("Power Spike"));
                check("system automatically detects a threshold breach",spike.body().contains("POTENTIAL OVERLOAD")&&spike.body().contains("detectedCondition"));
                check("preset scenario clears manual additional load",!spike.body().contains("Simulated additional load")&&Math.abs(extractNumber(spike.body(),"manualExtraKWh"))<0.001);
                HttpResponse<String> badManual=send(client,base+"/api/simulate?watts=500&hours=25","POST");check("manual operating hours are range-validated",badManual.statusCode()==400);
                HttpResponse<String> badMode=send(client,base+"/api/scenario?mode=not-valid","POST");check("unsupported scenario rejected",badMode.statusCode()==400);
                HttpResponse<String> badArea=send(client,base+"/api/area?id=kitchen&dailyKWh=-4&peakW=100&thresholdW=200","POST");check("negative energy input rejected",badArea.statusCode()==400);
                HttpResponse<String> badSettings=send(client,base+"/api/settings?tariff=8&normal=8000&overload=7000","POST");check("inconsistent thresholds rejected",badSettings.statusCode()==400);
                HttpResponse<String> returnCampus=send(client,base+"/api/profile?id=campus","POST");check("switch back to campus profile",returnCampus.statusCode()==200&&returnCampus.body().contains("MITS Academic Campus")&&returnCampus.body().contains("Computer Labs"));
                HttpResponse<String> page=send(client,base+"/","GET");check("multi-page dashboard HTML is served",page.statusCode()==200&&page.body().contains("data-page=\"dashboard\"")&&page.body().contains("data-page=\"simulation\"")&&page.body().contains("tourBackdrop"));
                HttpResponse<String> js=send(client,base+"/app.js","GET");check("interactive client features are served",js.statusCode()==200&&js.body().contains("renderLineChart")&&js.body().contains("saveArea")&&js.body().contains("openTour"));
                check("area threshold editor and automatic alerts are present",js.statusCode()==200&&js.body().contains("areaThresholdInput")&&js.body().contains("No active alerts")&&js.body().contains("Automatically detected condition"));
                check("periodic refresh no longer overwrites active form inputs",js.statusCode()==200&&!js.body().contains("setInterval(()=>refreshData"));
                HttpResponse<String> css=send(client,base+"/styles.css","GET");check("responsive and hover navigation styles are served",css.statusCode()==200&&css.body().contains(".sidebar:hover")&&css.body().contains("max-width:640px")&&css.body().contains("body.dark"));
                check("editable user identity control is present",page.body().contains("id=\"profileEditor\"")&&js.body().contains("smartgrid-user-name")&&js.body().contains("editUserIdentity"));
                check("threshold-aware demand chart uses classification colours",js.body().contains("NORMAL LIMIT")&&js.body().contains("OVERLOAD LIMIT")&&js.body().contains("#d34f56")&&js.body().contains("#d59b32"));
                check("trend explanation is displayed with percentage change",page.body().contains("id=\"trendDetail\"")&&js.body().contains("first-half to second-half average"));
                HttpResponse<String> metrics=send(client,base+"/api/metrics","GET");check("metrics endpoint",metrics.statusCode()==200&&metrics.body().contains("profileCount\":2"));
                HttpResponse<String> wrong=send(client,base+"/api/analytics","POST");check("wrong HTTP method rejected",wrong.statusCode()==405);
                long start=System.nanoTime();boolean all=true;for(int i=0;i<100;i++){if(send(client,base+"/api/health","GET").statusCode()!=200)all=false;}long ms=(System.nanoTime()-start)/1_000_000;check("100-request light load",all);System.out.println("[INFO] 100 health requests elapsed: "+ms+" ms");
            }
        } finally {server.destroy();if(!server.waitFor(2,TimeUnit.SECONDS))server.destroyForcibly();}
        testJavaFallback();
        System.out.println("RESULT: "+passed+" passed, "+failed+" failed");if(failed>0)System.exit(1);
    }
    private static void testJavaFallback() throws Exception {
        int port=18082;
        Process server=new ProcessBuilder(javaCommand(),"-Dsmartgrid.port="+port,"-Dsmartgrid.forceJavaAnalytics=true","-cp","out","SmartGridServer").redirectErrorStream(true).start();
        try {
            HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            String base="http://127.0.0.1:"+port;boolean up=false;
            for(int i=0;i<50;i++){try{if(send(client,base+"/api/health","GET").statusCode()==200){up=true;break;}}catch(Exception ignored){}Thread.sleep(100);}
            check("fallback test server starts",up);
            if(up){HttpResponse<String> analytics=send(client,base+"/api/analytics","GET");check("Java fallback supplies trend and forecast without C++",analytics.statusCode()==200&&analytics.body().contains("JAVA_FALLBACK")&&analytics.body().contains("forecastNextW")&&analytics.body().contains("\"trend\":\""));}
        } finally {server.destroy();if(!server.waitFor(2,TimeUnit.SECONDS))server.destroyForcibly();}
    }
    private static double extractNumber(String json,String key){String token="\""+key+"\":";int i=json.indexOf(token);if(i<0)return Double.NaN;i+=token.length();int j=i;while(j<json.length()&&(Character.isDigit(json.charAt(j))||json.charAt(j)=='.'||json.charAt(j)=='-'))j++;return Double.parseDouble(json.substring(i,j));}
    private static String javaCommand(){return System.getProperty("java.home")+File.separator+"bin"+File.separator+(System.getProperty("os.name").toLowerCase().contains("win")?"java.exe":"java");}
    private static HttpResponse<String> send(HttpClient c,String url,String method)throws Exception{return c.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(5)).method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());}
}
