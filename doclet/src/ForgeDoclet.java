import java.io.File;
import java.io.FileReader;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Map.Entry;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.javadoc.AnnotationDesc;
import com.sun.javadoc.ClassDoc;
import com.sun.javadoc.DocErrorReporter;
import com.sun.javadoc.Doclet;
import com.sun.javadoc.FieldDoc;
import com.sun.javadoc.RootDoc;

public class ForgeDoclet extends Doclet
{
	public static Connection mysql;
	public static String escapedName;
	public static JsonObject config;
	public static JsonObject version;
	
	public static boolean start(RootDoc root)
	{
		boolean forceUpdate = false;
		
		String path = "";
		for(String[] options : root.options())
		{
			if(options[0].equals("-path")) path = options[1];
			else if(options[0].equals("-forgeversion"))
				version = new JsonParser().parse(options[1]).getAsJsonObject();
			else if(options[0].equals("-force"))
				forceUpdate = true;
		}
		
		File rootFolder = new File(path);
		try {
			config = new JsonParser().parse(new FileReader(new File(rootFolder + "/config.json"))).getAsJsonObject();
		} catch (Exception e) {
			root.printError("No valid configuration file found in path " + rootFolder);
			e.printStackTrace();
			return false;
		}
		
		try {
			connectToMySQL();
		} catch (SQLException e) {
			root.printError("Couldn't connect to database.");
			e.printStackTrace();
			return false;
		}
		
		try {
			String currentVersion = version.get("mcversion").getAsString();
			String previousVersion = null;
			
			ArrayList<String> versions = new ArrayList<String>();
			ResultSet res = executeSQLQuery("SELECT (mcversion) FROM versions");
			while(res.next()) versions.add(res.getString(1));
			versions.sort((a, b) -> {
				String[] splitA = a.split("\\.");
				String[] splitB = b.split("\\.");
				int length = Math.max(splitA.length, splitB.length);
				for(int i = 0; i < length; i++)
				{
					int digita = i < splitA.length ? Integer.parseInt(splitA[i]) : 0;
					int digitb = i < splitB.length ? Integer.parseInt(splitB[i]) : 0;
					if(digita > digitb) return 1;
					else if(digita < digitb) return -1;
				}
				return 0;
			});
			int index = versions.indexOf(currentVersion);
			if(index - 1 >= 0) previousVersion = versions.get(index - 1);
			
			//Escape versions for database names
			currentVersion = currentVersion.replaceAll("\\.", "_");
			if(previousVersion != null) 
			{
				root.printNotice("Previous version: " + previousVersion);
				previousVersion = previousVersion.replaceAll("\\.", "_");
			}
			
			JsonArray eventbusArray = version.get("eventbus").getAsJsonArray();
			
			root.printNotice("Scanning classes for Forge Events...");
			for(ClassDoc classdoc : root.classes())
			{
				root.printNotice("Inspecting class " + classdoc.qualifiedName());
				boolean isFMLEvent = isSubclassOf(classdoc, "FMLEvent");
				boolean isEvent = isSubclassOf(classdoc, "Event");
				if(!(isFMLEvent || isEvent)) 
				{
					root.printNotice("Class is not an event, skipping...");
					continue;
				}
				
				String name = classdoc.typeName();
				String classname = classdoc.qualifiedName();
				String superclass = classdoc.superclass() != null ? classdoc.superclass().qualifiedName() : "java.lang.Object";
				int side = classname.contains("client") ? 1 : 2;

				JsonArray fieldsJson = new JsonArray();
				for(FieldDoc fielddoc : classdoc.fields())
				{
					if(fielddoc.isFinal() && fielddoc.isPublic())
					{
						JsonObject fieldObj = new JsonObject();
						fieldObj.addProperty(fielddoc.name(), fielddoc.type().simpleTypeName());
						fieldsJson.add(fieldObj);
					}
				}
				String fields = new Gson().toJson(fieldsJson);
				boolean deprecated = false;
				
				int result = 0;
				for(AnnotationDesc andesc : classdoc.annotations())
				{
					String type = andesc.annotationType().typeName();
					root.printNotice("Annotation found: " + type);
					if(type.equals("Event.HasResult")) result |= 1;
					if(type.equals("Cancelable")) result |= 2;
					deprecated = type.equals("Deprecated");
				}
				
				String description = classdoc.getRawCommentText();
				String since = escapedName;
				
				if(previousVersion != null) 
				{
					res = executeSQLQuery("SELECT since FROM raw_" + previousVersion + " WHERE name = ?", name);
					if(res.next()) since = res.getString(1);
					res.close();
				}
				
				//Event bus
				String eventbus = "";
				Iterator<JsonElement> iterator = eventbusArray.iterator();
				while(iterator.hasNext())
				{
					JsonObject bus = iterator.next().getAsJsonObject();
					Entry<String, JsonElement> entry = (Entry<String, JsonElement>)bus.entrySet().toArray()[0];
					String busPackage = entry.getKey();
					if(classname.startsWith(busPackage)) 
					{
						eventbus = entry.getValue().getAsString();
						break;
					}
				}
				
				root.printNotice("[" + name + " fields: " + fields.toString() + ", result: " + result + ", eventbus: " + eventbus + ", since: " + since + ", deprecated: " + deprecated + "]");
				root.printNotice("Pushing to database...");
				
				executeSQLUpdate("INSERT INTO raw_" + escapedName + " (name, class, superclass, fields, description, eventbus, since, result, side, deprecated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", 
					name, classname, superclass, fields, description, eventbus, since, result, side, deprecated);
				
				root.printNotice("...success!");
			}
		} catch (SQLException e) {
			root.printError("SQL error. Some changes might be discarted.");
			e.printStackTrace();
		}
		
		try {
			executeSQLQuery("SELECT 1 FROM " + escapedName + " LIMIT 1");
		} catch (SQLException e) {
			forceUpdate = true;
		}
		
		if(forceUpdate) 
		{
			root.printNotice("Cloning raw table to production table");
			try {
				executeSQLUpdate("CREATE TABLE IF NOT EXISTS " + escapedName +  " LIKE raw_" + escapedName);
				executeSQLUpdate("INSERT " + escapedName + " SELECT * FROM raw_" + escapedName);
			} catch (SQLException e2) {
				root.printError("Counldn't create the production table! Some changes might be discarted.");
				e2.printStackTrace();
			}
		}
		
		try {
			mysql.close();
		} catch (SQLException e) {
			e.printStackTrace();
		}
		return true;
	}
	
	public static void executeSQLUpdate(String sql, Object... params) throws SQLException
	{
		PreparedStatement statement = mysql.prepareStatement(sql);
		for(int i = 0; i < params.length; i++) statement.setObject(i + 1, params[i]);
		statement.executeUpdate();
		statement.close();
	}
	
	public static ResultSet executeSQLQuery(String sql, Object... params) throws SQLException
	{
		PreparedStatement statement = mysql.prepareStatement(sql);
		for(int i = 0; i < params.length; i++) statement.setObject(i + 1, params[i]);
		statement.closeOnCompletion();
		return statement.executeQuery();
	}
	
	public static boolean isSubclassOf(ClassDoc doc, String classname)
	{
		while(doc != null)
		{
			if(doc.simpleTypeName().equals(classname)) return true;
			doc = doc.superclass();
		}
		return false;
	}
	
	public static void connectToMySQL() throws SQLException
	{
		escapedName = version.get("mcversion").getAsString().replaceAll("\\.", "_");
		JsonObject mySQL = config.get("mySQL").getAsJsonObject();
		
		String url = mySQL.has("host") ? mySQL.get("host").getAsString() : "localhost";
		String user = mySQL.has("user") ? mySQL.get("user").getAsString() : "root";
		String password = mySQL.has("password") ? mySQL.get("password").getAsString() : "";
		String port = mySQL.has("port") ? mySQL.get("port").getAsString() : "3306";
		
		mysql = DriverManager.getConnection(String.format("jdbc:mysql://%s:%s/?user=%s&password=%s", url, port, user, password));
		Statement statement = mysql.createStatement();
		statement.execute("CREATE DATABASE IF NOT EXISTS " + config.get("database").getAsString());
		statement.execute("USE " + config.get("database").getAsString());
		statement.execute("CREATE TABLE IF NOT EXISTS raw_" + escapedName + " ("
			+ "id INT(6) UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+ "name TINYTEXT NOT NULL,"
			+ "class TINYTEXT NOT NULL,"
			+ "superclass TINYTEXT NOT NULL,"
			+ "fields TEXT,"
			+ "description TEXT,"
			+ "eventbus TINYTEXT,"
			+ "since TINYTEXT,"
			+ "result TINYINT(1) UNSIGNED,"
			+ "side TINYINT(1) UNSIGNED,"
			+ "deprecated BOOLEAN"
			+ ")");
		statement.execute("TRUNCATE TABLE raw_" + escapedName);
		statement.execute("CREATE TABLE IF NOT EXISTS versions ("
			+ "tableid VARCHAR(10) NOT NULL PRIMARY KEY,"
			+ "mcversion VARCHAR(10) NOT NULL,"
			+ "forgeversion VARCHAR(20) NOT NULL,"
			+ "eventbusList TEXT"
			+ ")");
		statement.execute("REPLACE INTO versions (tableid, mcversion, forgeversion) VALUES (\"" + escapedName + "\"," + version.get("mcversion") + "," + version.get("forgeversion") + ")");
		statement.close();
	}
	
	public static int optionLength(String option) 
	{
		if(option.equals("-path")) return 2;
		else if(option.equals("-forgeversion")) return 2;
		else if(option.equals("-force")) return 1;
		return 0;
	}
	
	public static boolean validOptions(String[][] args, DocErrorReporter reporter)
	{
		for(String[] arg : args)
			if(arg[0].equals("-forgeversion")) return true;
		reporter.printError("No forge version specified with -forgeversion <mc> <forge>");
		return false;
	}
}
