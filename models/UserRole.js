const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const UserRole = sequelize.define('UserRole', {
        role_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        role: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
        },
    }, {
        tableName: 'user_roles',
        timestamps: false,
    });

    UserRole.associate = (models) => {
        UserRole.hasMany(models.User, {
            foreignKey: 'role_id',
            as: 'users',
        });
    };

    return UserRole;
};
