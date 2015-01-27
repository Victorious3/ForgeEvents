import java.io.File;
import java.io.FileReader;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.stream.JsonReader;
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
	public static Map<String, Object> config = new HashMap<String, Object>();
	public static Map<String, Object> version = new HashMap<String, Object>();
	
	public static boolean start(RootDoc root)
	{
		String path = "";
		for(String[] options : root.options())
		{
			if(options[0].equals("-path")) path = options[1];
			else if(options[0].equals("-forgeversion"))
				version = new Gson().fromJson(options[1], version.getClass());
		}
		
		File rootFolder = new File(path);
		try {
			readConfiguration(new File(rootFolder + "/config.json"));
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

				JsonArray fields = new JsonArray();
				for(FieldDoc fielddoc : classdoc.fields())
				{
					if(fielddoc.isFinal() && fielddoc.isPublic())
					{
						JsonObject fieldObj = new JsonObject();
						fieldObj.addProperty(fielddoc.name(), fielddoc.type().simpleTypeName());
						fields.add(fieldObj);
					}
				}
				String fieldsJson = new Gson().toJson(fields);
				boolean isDeprecated = false;
				
				int result = 0;
				for(AnnotationDesc andesc : classdoc.annotations())
				{
					String type = andesc.annotationType().typeName();
					root.printNotice("Annotation found: " + type);
					if(type.equals("Event.HasResult")) result |= 1;
					if(type.equals("Cancelable")) result |= 2;
					isDeprecated = type.equals("Deprecated");
				}
				
				String description = classdoc.getRawCommentText();
				
				root.printNotice("[" + name + " fields: " + fieldsJson.toString() + ", result: " + result + ", deprecated: " + isDeprecated + "]");
				root.printNotice("Pushing to database...");
				
				//TODO Helper functions!
				PreparedStatement statement = mysql.prepareStatement("INSERT INTO " + escapedName + " (name, class, superclass, fields, description, result, deprecated) VALUES (?, ?, ?, ?, ?, ?, ?)");
				statement.setString(1, name);
				statement.setString(2, classname);
				statement.setString(3, superclass);
				statement.setString(4, fieldsJson);
				statement.setString(5, description);
				statement.setInt(6, result);
				statement.setBoolean(7, isDeprecated);
				statement.executeUpdate();
				statement.close();
				
				root.printNotice("...success!");
			}
		} catch (SQLException e) {
			root.printError("SQL error. Some changes might be discarted.");
			e.printStackTrace();
		}
		
		try {
			mysql.close();
		} catch (SQLException e) {
			e.printStackTrace();
		}
		return true;
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
	
	public static void readConfiguration(File configFile) throws Exception
	{
		config = new Gson().fromJson(new JsonReader(new FileReader(configFile)), config.getClass());
	}
	
	public static void connectToMySQL() throws SQLException
	{
		escapedName = version.get("mcversion").toString().replaceAll("\\.", "_");
		Map<String, Object> mySQL = (Map<String, Object>)config.get("mySQL");
		
		String url = (String)mySQL.get("host");
		String user = (String)mySQL.get("user");
		String password = (String)mySQL.get("password");
		String port = (String)mySQL.get("port");
		
		url = url != null ? url : "localhost";
		user = user != null ? user : "root";
		password = password != null ? password : "";
		port = port != null ? port : "3306";
		
		mysql = DriverManager.getConnection(String.format("jdbc:mysql://%s:%s/?user=%s&password=%s", url, port, user, password));
		Statement statement = mysql.createStatement();
		statement.execute("CREATE DATABASE IF NOT EXISTS " + config.get("database"));
		statement.execute("USE " + config.get("database"));
		statement.execute("CREATE TABLE IF NOT EXISTS " + escapedName + " ("
			+ "id INT(6) UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
			+ "name TINYTEXT NOT NULL,"
			+ "class TINYTEXT NOT NULL,"
			+ "superclass TINYTEXT NOT NULL,"
			+ "fields TEXT,"
			+ "description TEXT,"
			+ "eventbus INT(2) UNSIGNED,"
			+ "since TINYTEXT,"
			+ "result TINYINT(1) UNSIGNED,"
			+ "side BOOLEAN,"
			+ "deprecated BOOLEAN"
			+ ")");
		statement.execute("TRUNCATE TABLE " + escapedName);
		statement.execute("CREATE TABLE IF NOT EXISTS versions ("
			+ "id VARCHAR(10) PRIMARY KEY NOT NULL,"
			+ "mcversion TINYTEXT NOT NULL,"
			+ "forgeversion TINYTEXT NOT NULL,"
			+ "eventbusList TEXT"
			+ ")");
		statement.execute("REPLACE INTO versions (id, mcversion, forgeversion) VALUES (\"" + escapedName + "\",\"" + version.get("mcversion") + "\",\"" + version.get("forgeversion") + "\")");
		statement.close();
	}
	
	public static int optionLength(String option) 
	{
		if(option.equals("-path")) return 2;
		else if(option.equals("-forgeversion")) return 2;
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
