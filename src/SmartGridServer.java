import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** SmartGrid Analytics v7: multi-profile building and home energy management prototype. */
public class SmartGridServer {
    private static final int PORT = Integer.getInteger("smartgrid.port", 8080);
    private static final String HOST = System.getProperty("smartgrid.host", "0.0.0.0");
    private static final Object LOCK = new Object();
    private static final AtomicLong requestCount = new AtomicLong();
    private static final Map<String, Profile> PROFILES = createProfiles();
    private static String activeProfileId = "campus";
    private static String scenario = "Normal";
    private static List<Integer> readings = new ArrayList<>();
    private static int manualLoadWatts = 0;
    private static int manualLoadThresholdW = 0;
    private static double manualLoadHours = 0;

    private static final class Equipment {
        final String name; final int share;
        Equipment(String name, int share) { this.name=name; this.share=share; }
    }
    private static final class Area {
        final String id, name, category, icon; final List<Equipment> equipment;
        double dailyKWh; int peakW, thresholdW;
        Area(String id,String name,String category,String icon,double dailyKWh,int peakW,Equipment... equipment) {
            this.id=id;this.name=name;this.category=category;this.icon=icon;this.dailyKWh=dailyKWh;this.peakW=peakW;this.thresholdW=Math.max(1,(int)Math.round(peakW*1.25));this.equipment=Arrays.asList(equipment);
        }
    }
    private static final class Profile {
        final String id, name, propertyName, description; final List<Area> areas;
        double tariff; int normalThresholdW, overloadThresholdW;
        Profile(String id,String name,String propertyName,String description,double tariff,int normal,int overload,Area... areas) {
            this.id=id;this.name=name;this.propertyName=propertyName;this.description=description;this.tariff=tariff;this.normalThresholdW=normal;this.overloadThresholdW=overload;this.areas=new ArrayList<>(Arrays.asList(areas));
        }
    }

    private static Map<String,Profile> createProfiles() {
        Map<String,Profile> m=new LinkedHashMap<>();
        m.put("campus",new Profile("campus","Campus / College","MITS Academic Campus (Demo)","Buildings, departments, shared facilities and equipment",8.0,15000,20500,
            new Area("labs","Computer Labs","Academic","▦",52.0,4800,new Equipment("Desktop workstations",58),new Equipment("Air conditioning",22),new Equipment("Lighting",10),new Equipment("Networking and UPS",10)),
            new Area("classrooms","Classrooms & Lecture Halls","Academic","▤",34.0,3600,new Equipment("Fans and air conditioning",48),new Equipment("Lighting",22),new Equipment("Projectors and displays",12),new Equipment("Teaching equipment",18)),
            new Area("library","Library & Reading Rooms","Academic","▥",21.0,1500,new Equipment("Lighting",28),new Equipment("Computers",24),new Equipment("Cooling and ventilation",38),new Equipment("Other equipment",10)),
            new Area("admin","Administration Offices","Operations","▣",14.0,1200,new Equipment("Office computers",38),new Equipment("Cooling",34),new Equipment("Lighting",18),new Equipment("Printers and other",10)),
            new Area("hostels","Hostels & Student Housing","Residential","⌂",31.0,4200,new Equipment("Room fans and cooling",44),new Equipment("Lighting",20),new Equipment("Water pumps",16),new Equipment("Common appliances",20)),
            new Area("canteen","Canteen & Food Services","Services","♨",17.0,1800,new Equipment("Cooking equipment",42),new Equipment("Refrigeration",28),new Equipment("Ventilation",15),new Equipment("Lighting",15)),
            new Area("auditorium","Auditorium & Events","Facilities","◫",12.0,2500,new Equipment("Stage and AV systems",42),new Equipment("Air conditioning",36),new Equipment("Lighting",17),new Equipment("Other",5)),
            new Area("sports","Sports & Outdoor Areas","Facilities","◉",5.0,700,new Equipment("Field lighting",55),new Equipment("Fitness equipment",20),new Equipment("Pumps and other",25)),
            new Area("common","Common Areas & Corridors","Facilities","⌁",8.0,1000,new Equipment("Corridor lighting",48),new Equipment("Lifts and pumps",32),new Equipment("Other shared loads",20))
        ));
        m.put("home",new Profile("home","Residential / Home","Smart Home (Demo)","Rooms, household appliances and everyday electricity use",7.5,4800,7200,
            new Area("living","Living Room","Living spaces","⌂",3.4,1300,new Equipment("Television and media",20),new Equipment("Air conditioner / fan",48),new Equipment("Lighting",18),new Equipment("Other devices",14)),
            new Area("bedrooms","Bedrooms","Living spaces","▣",2.8,900,new Equipment("Fans and cooling",52),new Equipment("Lighting",20),new Equipment("Chargers and devices",18),new Equipment("Other",10)),
            new Area("kitchen","Kitchen","Utility spaces","♨",4.9,2100,new Equipment("Refrigerator",38),new Equipment("Microwave and cooking",30),new Equipment("Mixer and small appliances",17),new Equipment("Lighting and exhaust",15)),
            new Area("work","Work / Study Area","Living spaces","▤",1.6,850,new Equipment("Computer and monitor",48),new Equipment("Cooling",25),new Equipment("Lighting",17),new Equipment("Networking",10)),
            new Area("bath","Bathrooms","Utility spaces","≈",0.8,450,new Equipment("Water heater",62),new Equipment("Exhaust fan",15),new Equipment("Lighting",23)),
            new Area("laundry","Laundry & Utility","Utility spaces","◌",2.1,1650,new Equipment("Washing machine",54),new Equipment("Iron",28),new Equipment("Water pump",18)),
            new Area("outdoor","Outdoor & Shared","Utility spaces","✧",0.6,300,new Equipment("Outdoor lighting",56),new Equipment("Other small loads",44))
        ));
        return m;
    }

    public static void main(String[] args) throws Exception {
        synchronized(LOCK) { generateReadings("Normal"); }
        HttpServer server=HttpServer.create(new InetSocketAddress(HOST,PORT),0);
        server.createContext("/api/health",ex->{if(method(ex,"GET"))send(ex,200,"{\"status\":\"healthy\",\"version\":\"7.0\"}");});
        server.createContext("/api/state",SmartGridServer::handleState);
        server.createContext("/api/profile",SmartGridServer::handleProfile);
        server.createContext("/api/area",SmartGridServer::handleArea);
        server.createContext("/api/settings",SmartGridServer::handleSettings);
        server.createContext("/api/scenario",SmartGridServer::handleScenario);
        server.createContext("/api/simulate",SmartGridServer::handleSimulate);
        server.createContext("/api/analytics",SmartGridServer::handleAnalytics);
        server.createContext("/api/metrics",ex->{if(method(ex,"GET")){requestCount.incrementAndGet();send(ex,200,"{\"requestsServed\":"+requestCount.get()+",\"storedReadings\":"+readingCount()+",\"profileCount\":2}");}});
        server.createContext("/",SmartGridServer::handleStatic);
        server.setExecutor(Executors.newFixedThreadPool(Math.max(4,Runtime.getRuntime().availableProcessors())));
        server.start();
        System.out.println("SmartGrid Analytics v7 running at http://localhost:"+PORT);
        System.out.println("Profiles: Campus / College and Residential / Home");
        printMobileAddresses();
        System.out.println("All readings are simulated. Keep this window open; press Ctrl+C to stop.");
    }

    private static void printMobileAddresses() {
        System.out.println("Phone access (same Wi-Fi):");
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress())
                        System.out.println("  http://" + address.getHostAddress() + ":" + PORT);
                }
            }
        } catch (SocketException e) {
            System.out.println("  Run ipconfig and open http://YOUR-PC-IPv4:" + PORT + " on the phone.");
        }
        System.out.println("If the phone cannot connect, allow Java through Windows Firewall on Private networks.");
    }

    private static boolean method(HttpExchange ex,String expected)throws IOException {
        if(!expected.equalsIgnoreCase(ex.getRequestMethod())){send(ex,405,"{\"error\":\"Method not allowed\",\"expected\":\""+expected+"\"}");return false;}return true;
    }
    private static Profile active(){return PROFILES.get(activeProfileId);}
    private static int readingCount(){synchronized(LOCK){return readings.size();}}
    private static int totalPeak(Profile p){int n=0;for(Area a:p.areas)n+=a.peakW;return n;}
    private static double totalDaily(Profile p){double n=0;for(Area a:p.areas)n+=a.dailyKWh;return n;}
    private static String statusFor(int watts,Profile p){if(watts>p.overloadThresholdW)return "POTENTIAL OVERLOAD";if(watts>p.normalThresholdW)return "HIGH CONSUMPTION";return "NORMAL";}
    private static List<Integer> buildReadings(String mode){
        Profile p=active();int cap=Math.max(1,totalPeak(p));double[] normal={.46,.48,.47,.49,.50,.48,.49,.50,.51,.49,.50,.51};
        double[] high={.55,.62,.68,.72,.78,.82,.86,.88,.91,.89,.87,.90};
        double[] spike={.42,.44,.46,.43,.45,.47,.49,.51,1.06,.52,.48,.46};
        double[] overload={.88,.92,.95,.98,1.01,1.04,1.07,1.09,1.12,1.10,1.08,1.11};
        double[] selected=mode.equals("High Consumption")?high:mode.equals("Power Spike")?spike:mode.equals("Potential Overload")?overload:normal;
        List<Integer> result=new ArrayList<>();for(double f:selected)result.add((int)Math.round(cap*f));return result;
    }
    private static void clearManualLoad(){manualLoadWatts=0;manualLoadThresholdW=0;manualLoadHours=0;}
    private static void generateReadings(String mode){clearManualLoad();readings=buildReadings(mode);scenario=mode;}
    private static void generateCustomReadings(int watts,double hours){
        manualLoadWatts=watts;manualLoadThresholdW=Math.max(1,(int)Math.round(watts*1.25));manualLoadHours=hours;readings=buildReadings("Normal");
        for(int i=0;i<readings.size();i++)readings.set(i,readings.get(i)+watts);
        scenario="Manual additional load";
    }
    private static double manualExtraKWh(){return manualLoadWatts*manualLoadHours/1000.0;}


    private static void handleState(HttpExchange ex)throws IOException{if(!method(ex,"GET"))return;String body=stateSnapshot();requestCount.incrementAndGet();send(ex,200,body);}
    private static void handleProfile(HttpExchange ex)throws IOException{
        if(!method(ex,"POST"))return;String id=param(ex,"id");synchronized(LOCK){if(!PROFILES.containsKey(id)){send(ex,400,"{\"error\":\"Choose campus or home\"}");return;}activeProfileId=id;generateReadings("Normal");}
        requestCount.incrementAndGet();send(ex,200,stateSnapshot());
    }
    private static void handleArea(HttpExchange ex)throws IOException{
        if(!method(ex,"POST"))return;
        String id=param(ex,"id"),daily=param(ex,"dailyKWh"),peak=param(ex,"peakW"),threshold=param(ex,"thresholdW");
        synchronized(LOCK){
            try{
                double d=Double.parseDouble(daily);int w=Integer.parseInt(peak);int tw=Integer.parseInt(threshold);
                if(!Double.isFinite(d)||d<0||d>10000||w<0||w>100000||tw<1||tw>100000){send(ex,400,"{\"error\":\"Enter daily energy from 0 to 10000 kWh and power/threshold values from 1 to 100000 W\"}");return;}
                if("manual-load".equals(id)){
                    manualLoadWatts=w;manualLoadThresholdW=tw;manualLoadHours=w>0?d*1000.0/w:0;
                    if(w>0){readings=buildReadings("Normal");for(int i=0;i<readings.size();i++)readings.set(i,readings.get(i)+w);scenario="Manual additional load";}
                    else{clearManualLoad();generateReadings("Normal");}
                } else {
                    Area found=findArea(active(),id);if(found==null){send(ex,404,"{\"error\":\"Area not found\"}");return;}
                    found.dailyKWh=d;found.peakW=w;found.thresholdW=tw;
                    // Preserve the current test pattern when an area is edited. Do not silently reset the simulator.
                    if(manualLoadWatts>0){readings=buildReadings("Normal");for(int i=0;i<readings.size();i++)readings.set(i,readings.get(i)+manualLoadWatts);scenario="Manual additional load";}
                    else {readings=buildReadings(scenario);}
                }
            }catch(Exception e){send(ex,400,"{\"error\":\"Invalid area values. Check daily energy, peak power and area threshold\"}");return;}
        }
        requestCount.incrementAndGet();send(ex,200,stateSnapshot());
    }

    private static void handleSettings(HttpExchange ex)throws IOException{
        if(!method(ex,"POST"))return;String t=param(ex,"tariff"),n=param(ex,"normal"),o=param(ex,"overload");
        synchronized(LOCK){try{double tariff=Double.parseDouble(t);int normal=Integer.parseInt(n),overload=Integer.parseInt(o);if(!Double.isFinite(tariff)||tariff<0||tariff>1000||normal<1||overload<=normal||overload>100000){send(ex,400,"{\"error\":\"Check tariff and threshold values. Overload threshold must exceed the normal threshold.\"}");return;}Profile p=active();p.tariff=tariff;p.normalThresholdW=normal;p.overloadThresholdW=overload;}
            catch(Exception e){send(ex,400,"{\"error\":\"Invalid settings\"}");return;}}
        requestCount.incrementAndGet();send(ex,200,stateSnapshot());
    }
    private static void handleScenario(HttpExchange ex)throws IOException{
        if(!method(ex,"POST"))return;String mode=param(ex,"mode");if(!Arrays.asList("Normal","High Consumption","Power Spike","Potential Overload").contains(mode)){send(ex,400,"{\"error\":\"Unsupported scenario\"}");return;}
        synchronized(LOCK){generateReadings(mode);}requestCount.incrementAndGet();send(ex,200,stateSnapshot());
    }
    private static void handleSimulate(HttpExchange ex)throws IOException{
        if(!method(ex,"POST"))return;try{int w=Integer.parseInt(param(ex,"watts"));double hours=Double.parseDouble(param(ex,"hours"));if(w<0||w>100000||!Double.isFinite(hours)||hours<0||hours>24){send(ex,400,"{\"error\":\"Added load must be 0-100000 W and operating time must be 0-24 hours\"}");return;}synchronized(LOCK){if(w==0||hours==0)generateReadings("Normal");else generateCustomReadings(w,hours);}}
        catch(Exception e){send(ex,400,"{\"error\":\"Enter valid whole-number watts and operating hours\"}");return;}requestCount.incrementAndGet();send(ex,200,stateSnapshot());
    }

    private static void handleAnalytics(HttpExchange ex)throws IOException{
        if(!method(ex,"GET"))return;
        List<Integer> copy;int normal,overload;
        synchronized(LOCK){copy=new ArrayList<>(readings);normal=active().normalThresholdW;overload=active().overloadThresholdW;}
        try{
            String result;
            if(Boolean.getBoolean("smartgrid.forceJavaAnalytics")) {
                result=javaAnalyticsFallback(copy,normal,overload,"Fallback selected by test configuration");
            } else {
                try { result=runCpp(copy,normal,overload); }
                catch(Exception cppError) { result=javaAnalyticsFallback(copy,normal,overload,cppError.getMessage()); }
            }
            requestCount.incrementAndGet();send(ex,200,result);
        }catch(Exception e){send(ex,500,"{\"error\":\"Analytics calculation failed\",\"detail\":\""+escape(e.getMessage())+"\"}");}
    }
    private static String javaAnalyticsFallback(List<Integer> values,int normal,int overload,String reason){
        if(values.isEmpty())return "{\"error\":\"No readings available\"}";
        double avg=values.stream().mapToDouble(Integer::doubleValue).average().orElse(0);
        int middle=values.size()/2;
        double first=middle>0?values.subList(0,middle).stream().mapToDouble(Integer::doubleValue).average().orElse(avg):avg;
        double second=values.size()>middle?values.subList(middle,values.size()).stream().mapToDouble(Integer::doubleValue).average().orElse(avg):avg;
        String trend=second>first*1.05?"RISING":second<first*0.95?"FALLING":"STABLE";
        int low=0,high=0,over=0,peak=0;double sumX=0,sumY=0,sumXX=0,sumXY=0;
        for(int i=0;i<values.size();i++){int v=values.get(i);peak=Math.max(peak,v);if(v<=normal)low++;else if(v<=overload)high++;else over++;sumX+=i;sumY+=v;sumXX+=(double)i*i;sumXY+=(double)i*v;}
        double n=values.size(),den=n*sumXX-sumX*sumX,slope=den==0?0:(n*sumXY-sumX*sumY)/den,intercept=(sumY-slope*sumX)/n;
        double forecast=Math.max(0,Math.min(100000,intercept+slope*n));
        return String.format(Locale.US,"{\"trend\":\"%s\",\"averagePowerW\":%.2f,\"firstHalfAverageW\":%.2f,\"secondHalfAverageW\":%.2f,\"peakPowerW\":%d,\"forecastNextW\":%.2f,\"readingCount\":%d,\"clusters\":{\"low\":%d,\"medium\":%d,\"high\":%d},\"normalThresholdW\":%d,\"overloadThresholdW\":%d,\"engine\":\"JAVA_FALLBACK\",\"algorithm\":\"Java fallback: split-half trend and linear-regression next-sample estimate\",\"fallbackReason\":\"%s\"}",trend,avg,first,second,peak,forecast,values.size(),low,high,over,normal,overload,escape(reason==null?"C++ executable unavailable":reason));
    }

    private static String runCpp(List<Integer> values,int normal,int overload)throws Exception{
        String exeName=System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win")?"analytics.exe":"analytics";Path exe=Path.of("out",exeName).toAbsolutePath();if(!Files.isExecutable(exe))throw new FileNotFoundException(exe.toString());
        Process p=new ProcessBuilder(exe.toString()).redirectErrorStream(true).start();
        try(BufferedWriter w=new BufferedWriter(new OutputStreamWriter(p.getOutputStream(),StandardCharsets.UTF_8))){w.write(normal+"|"+overload+"|");for(int i=0;i<values.size();i++){if(i>0)w.write(',');w.write(Integer.toString(values.get(i)));}w.newLine();}
        if(!p.waitFor(5,TimeUnit.SECONDS)){p.destroyForcibly();throw new IOException("C++ analytics timed out");}String output=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim();if(p.exitValue()!=0||!output.startsWith("{"))throw new IOException(output.isEmpty()?"C++ analytics returned no output":output);return output;
    }
    private static Area findArea(Profile p,String id){for(Area a:p.areas)if(a.id.equals(id))return a;return null;}
    private static String stateSnapshot(){synchronized(LOCK){return stateJson();}}
    private static String stateJson(){
        Profile p=active();StringBuilder b=new StringBuilder("{");b.append("\"profileId\":\"").append(p.id).append("\",\"profileName\":\"").append(escape(p.name)).append("\",\"propertyName\":\"").append(escape(p.propertyName)).append("\",\"description\":\"").append(escape(p.description)).append("\",");
        double daily=totalDaily(p)+manualExtraKWh();int detectedPeak=0;for(int value:readings)detectedPeak=Math.max(detectedPeak,value);String detected=statusFor(detectedPeak,p);b.append("\"tariffPerKWh\":").append(fmt(p.tariff)).append(",\"normalThresholdW\":").append(p.normalThresholdW).append(",\"overloadThresholdW\":").append(p.overloadThresholdW).append(",\"detectedCondition\":\"").append(detected).append("\",\"detectedPeakW\":").append(detectedPeak).append(",\"dailyUnitsKWh\":").append(fmt(daily)).append(",\"monthlyUnitsKWh\":").append(fmt(daily*30)).append(",\"monthlyBill\":").append(fmt(daily*30*p.tariff)).append(",\"peakCapacityW\":").append(totalPeak(p)+manualLoadWatts).append(",\"manualLoadWatts\":").append(manualLoadWatts).append(",\"manualLoadHours\":").append(fmt(manualLoadHours)).append(",\"manualExtraKWh\":").append(fmt(manualExtraKWh())).append(",\"scenario\":\"").append(escape(scenario)).append("\",\"simulated\":true,\"areas\":[");
        for(int i=0;i<p.areas.size();i++){Area a=p.areas.get(i);if(i>0)b.append(',');b.append("{\"id\":\"").append(a.id).append("\",\"name\":\"").append(escape(a.name)).append("\",\"category\":\"").append(escape(a.category)).append("\",\"icon\":\"").append(escape(a.icon)).append("\",\"dailyKWh\":").append(fmt(a.dailyKWh)).append(",\"peakW\":").append(a.peakW).append(",\"thresholdW\":").append(a.thresholdW).append(",\"areaStatus\":\"").append(a.peakW>a.thresholdW?"AREA THRESHOLD EXCEEDED":"WITHIN AREA LIMIT").append("\",\"equipment\":[");
            for(int j=0;j<a.equipment.size();j++){Equipment e=a.equipment.get(j);if(j>0)b.append(',');b.append("{\"name\":\"").append(escape(e.name)).append("\",\"share\":").append(e.share).append("}");}b.append("]}");}
        if(manualLoadWatts>0){if(!p.areas.isEmpty())b.append(',');b.append("{\"id\":\"manual-load\",\"name\":\"Simulated additional load\",\"category\":\"What-if scenario\",\"icon\":\"ϟ\",\"dailyKWh\":").append(fmt(manualExtraKWh())).append(",\"peakW\":").append(manualLoadWatts).append(",\"thresholdW\":").append(manualLoadThresholdW).append(",\"areaStatus\":\"").append(manualLoadWatts>manualLoadThresholdW?"AREA THRESHOLD EXCEEDED":"WITHIN AREA LIMIT").append("\",\"equipment\":[{\"name\":\"User-defined additional load\",\"share\":100}]}");}
        b.append("],\"readings\":[");for(int i=0;i<readings.size();i++){int w=readings.get(i);if(i>0)b.append(',');b.append("{\"index\":").append(i+1).append(",\"powerW\":").append(w).append(",\"voltageV\":230,\"currentA\":").append(fmt(w/230.0)).append(",\"status\":\"").append(statusFor(w,p)).append("\"}");}return b.append("]}").toString();
    }
    private static String fmt(double x){return String.format(Locale.US,"%.2f",x);}
    private static String param(HttpExchange ex,String wanted){String q=ex.getRequestURI().getRawQuery();if(q==null)return "";for(String part:q.split("&")){String[] kv=part.split("=",2);if(kv.length==2&&kv[0].equals(wanted))try{return URLDecoder.decode(kv[1],StandardCharsets.UTF_8);}catch(Exception ignored){}}return "";}
    private static String escape(String s){return s==null?"":s.replace("\\","\\\\").replace("\"","\\\"").replace("\n"," ").replace("\r"," ");}
    private static void handleStatic(HttpExchange ex)throws IOException{
        if(!"GET".equalsIgnoreCase(ex.getRequestMethod())){send(ex,405,"Method not allowed");return;}String raw=ex.getRequestURI().getPath();String path="/".equals(raw)?"/index.html":raw;if(path.contains("..")||path.contains("\\")){send(ex,400,"Invalid path");return;}
        Path root=Path.of("web").toAbsolutePath().normalize(),file=root.resolve(path.substring(1)).normalize();if(!file.startsWith(root)||!Files.isRegularFile(file)){send(ex,404,"File not found");return;}String n=file.getFileName().toString();String type=n.endsWith(".html")?"text/html; charset=utf-8":n.endsWith(".css")?"text/css; charset=utf-8":n.endsWith(".js")?"application/javascript; charset=utf-8":"application/octet-stream";byte[] data=Files.readAllBytes(file);ex.getResponseHeaders().set("Content-Type",type);ex.getResponseHeaders().set("Cache-Control","no-store");ex.getResponseHeaders().set("X-Content-Type-Options","nosniff");ex.sendResponseHeaders(200,data.length);try(OutputStream o=ex.getResponseBody()){o.write(data);}
    }
    private static void send(HttpExchange ex,int code,String body)throws IOException{byte[] data=body.getBytes(StandardCharsets.UTF_8);ex.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");ex.getResponseHeaders().set("Cache-Control","no-store");ex.getResponseHeaders().set("X-Content-Type-Options","nosniff");ex.sendResponseHeaders(code,data.length);try(OutputStream o=ex.getResponseBody()){o.write(data);}}
}
